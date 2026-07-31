import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import { hashBackupCode, normalizeBackupCode } from "@/lib/backup-codes";
import { sendEmail } from "@/lib/email";

/**
 * v8.3 E0 — Canjea un código de respaldo por una sesión de owner_admin.
 *
 * Sin sesión previa a propósito (este endpoint ES el mecanismo de entrada
 * cuando no hay sesión -- Google inaccesible). No es un "olvidé mi
 * contraseña" público de todos modos: solo funciona si el caller ya tiene
 * uno de los códigos de un solo uso que el owner_admin generó con
 * antelación desde /admin/seguridad estando ya autenticado -- ese es el
 * único momento en que un código nuevo se crea.
 *
 * Cómo se crea la sesión (la parte técnicamente delicada, ver también el
 * comentario en StaffLoginScreen.tsx): un código de respaldo no es una
 * credencial nativa de Supabase Auth, así que no existe un
 * `supabase.auth.signInWith...` para "entrar con este string". En vez de
 * inventar un token de sesión custom (superficie nueva, JWT propio que
 * habría que firmar/verificar/rotar a mano), este endpoint reutiliza el
 * mecanismo NATIVO de Supabase para login sin contraseña: genera un
 * magic-link server-side con el service role
 * (supabase.auth.admin.generateLink) para el email del owner_admin dueño
 * del código.
 *
 * Fix auditoría 2026-07-30 (BUG-2 CRÍTICO): antes, el `token_hash` de ese
 * magic-link viajaba en texto plano en la respuesta JSON de esta request, y
 * el cliente lo canjeaba desde el navegador con
 * `supabase.auth.verifyOtp({ token_hash, type: "magiclink" })`. Eso exponía
 * innecesariamente un secreto de un solo uso al cliente. Ahora el canje se
 * hace aquí mismo, server-side, con un cliente @supabase/ssr atado a las
 * cookies de esta respuesta (mismo patrón que getSupabaseClient() en este
 * mismo módulo): `authClient.auth.verifyOtp({ token_hash, type: "magiclink" })`
 * establece la sesión directamente vía Set-Cookie en la respuesta de este
 * endpoint. El cliente nunca ve el token_hash -- solo recibe un booleano de
 * éxito y recarga la página con la sesión ya activa.
 */

export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Backup code login is not configured on this environment" },
      { status: 500 }
    );
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.code || typeof body.code !== "string") {
    return NextResponse.json({ error: "Missing backup code" }, { status: 400 });
  }

  // Rate limit por IP -- namespace separado del de cotizador (check_rate_limit
  // es un RPC genérico ya usado en src/app/api/quote/route.ts). El espacio de
  // códigos es de 96 bits así que fuerza bruta no es viable de todos modos,
  // pero esto es defensa en profundidad barata contra intentos repetidos.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const { data: rateLimitData } = await serviceClient.rpc("check_rate_limit", {
    p_ip_address: `backup-code:${ip}`,
    p_max_requests: 8,
  });
  if (rateLimitData && rateLimitData[0]?.allowed === false) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
    );
  }

  const normalized = normalizeBackupCode(body.code);
  const codeHash = hashBackupCode(normalized);

  // UPDATE atómico: solo marca used_at si el código sigue sin usar, sin
  // revocar, y no vencido (Fix auditoría 2026-07-30, BUG 2 -- ver
  // supabase/migrations/248_fix_owner_admin_backup_codes_expiry.sql y
  // BACKUP_CODE_TTL_DAYS en src/lib/backup-codes.ts). Un código vencido
  // simplemente no matchea la condición `.gt("expires_at", ...)` y cae al
  // mismo mensaje genérico de abajo -- mismo criterio de no distinguir la
  // causa exacta ("no existe" vs "ya se usó" vs "revocado" vs "vencido") que
  // ya aplicaba antes de este fix. Si dos requests llegan con el mismo
  // código a la vez, la fila (bloqueada por el UPDATE) solo se resuelve para
  // una -- la otra ve 0 filas afectadas y falla, así que el código nunca se
  // puede canjear dos veces aunque lleguen en paralelo.
  const { data: consumed, error: consumeError } = await serviceClient
    .from("owner_admin_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", codeHash)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, user_id")
    .maybeSingle();

  if (consumeError) {
    console.error("backup-codes verify update error:", consumeError);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  // Mensaje genérico a propósito (no distingue "código no existe" de "ya se
  // usó" de "fue revocado") -- no darle a un atacante información sobre cuál
  // de esas razones aplicó.
  if (!consumed) {
    return NextResponse.json({ error: "Invalid or already-used backup code" }, { status: 401 });
  }

  // Defensa en profundidad: confirmar que el dueño del código SIGUE siendo
  // owner_admin (podría habérsele quitado el rol después de generar el set).
  const { data: roleRow } = await serviceClient
    .from("admin_roles")
    .select("role")
    .eq("user_id", consumed.user_id)
    .eq("role", "owner_admin")
    .is("deleted_at", null)
    .maybeSingle();

  if (!roleRow) {
    return NextResponse.json(
      { error: "This account no longer has owner_admin access" },
      { status: 403 }
    );
  }

  const { data: userData, error: userError } = await serviceClient.auth.admin.getUserById(
    consumed.user_id
  );
  if (userError || !userData?.user?.email) {
    console.error("backup-codes verify getUserById error:", userError);
    return NextResponse.json({ error: "Could not resolve account" }, { status: 500 });
  }
  const email = userData.user.email;

  // Genera el magic-link nativo de Supabase server-side (service role) y
  // devuelve solo el token_hash -- ver limitación documentada arriba.
  const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("backup-codes verify generateLink error:", linkError);
    return NextResponse.json({ error: "Could not create session" }, { status: 500 });
  }

  // Canjea el token_hash aquí mismo (server-side) en vez de devolverlo al
  // cliente -- ver Fix BUG-2 arriba. getSupabaseClient() usa cookies() de
  // next/headers, así que verifyOtp aquí escribe la cookie de sesión
  // directamente en la respuesta HTTP de este Route Handler.
  const authClient = getSupabaseClient();
  const { error: sessionError } = await authClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionError) {
    console.error("backup-codes verify verifyOtp error:", sessionError);
    return NextResponse.json({ error: "Could not create session" }, { status: 500 });
  }

  // Alerta de seguridad inmediata al dueño de la cuenta: si no fue él, se
  // entera ahora. Se manda SIEMPRE, incluso si el envío real de email no
  // está configurado todavía (sendEmail queda en 'not_configured' de forma
  // determinista -- ver TODO en src/lib/email.ts) -- el intento igual queda
  // registrado abajo en admin_action_logs con service role para que quede
  // rastro server-side aunque el owner_admin nunca reciba el correo real.
  const usedAtVancouver = new Date().toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "long",
    timeStyle: "short",
  });
  try {
    await sendEmail({
      toEmail: email,
      subject: "Security alert: a backup code was used to sign in",
      body:
        `A backup code was used to sign in to the Lulu Island Flagship admin panel ` +
        `on ${usedAtVancouver} (Vancouver time). If this was you, no action is needed. ` +
        `If this was NOT you, someone else has one of your backup codes -- go to ` +
        `/admin/seguridad and generate a new set immediately (this invalidates all old codes), ` +
        `and review recent activity in Admin Action Logs.`,
    });
  } catch (e) {
    console.error("backup-codes verify security alert email failed:", e);
  }

  // Rastro server-side del evento, con service role (no hay sesión de
  // usuario todavía para que requireAdminRole lo logee por el camino normal).
  await serviceClient.from("admin_action_logs").insert({
    user_id: consumed.user_id,
    role_used: "owner_admin",
    method: "POST",
    path: "/api/admin/backup-codes/verify",
    resource: "security_backup_codes",
  });

  // El cliente nunca ve el token_hash ni ningún otro secreto -- la sesión ya
  // quedó establecida vía cookie en esta misma respuesta (ver arriba).
  return NextResponse.json({ success: true, email });
}

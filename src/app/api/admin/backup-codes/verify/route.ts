import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import { hashBackupCode, normalizeBackupCode } from "@/lib/backup-codes";
import { sendEmail } from "@/lib/email";
import { getClientIp } from "@/lib/request-ip";

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
 *
 * RIESGO RESIDUAL ACEPTADO (auditoría de infraestructura, pentest 2026-08-02):
 * este endpoint autentica al owner_admin con UN SOLO factor -- el código de
 * respaldo en sí -- sin pedir un segundo factor adicional (p.ej. TOTP) en el
 * momento del canje. Implementar un segundo factor real está fuera de
 * alcance de este fix (requeriría un flujo de enrolamiento/verificación TOTP
 * nuevo). Mitigaciones YA existentes que reducen este riesgo, verificadas en
 * este mismo archivo antes de aceptar el riesgo como residual:
 *   - Rate limiting por IP (namespace "backup-code:<ip>", 8 intentos, RPC
 *     check_rate_limit, falla CERRADO si el RPC mismo falla -- ver más abajo).
 *   - Espacio de códigos de 96 bits (fuerza bruta no es viable en la práctica
 *     aunque no hubiera rate limit).
 *   - Un solo uso por código (UPDATE atómico con `used_at IS NULL`, así que
 *     un código nunca se puede canjear dos veces ni en carrera).
 *   - Expiración (`expires_at`, BACKUP_CODE_TTL_DAYS en src/lib/backup-codes.ts)
 *     y revocación (`revoked_at`) explícitas.
 *   - Rotación: generar un set nuevo desde /admin/seguridad invalida todos
 *     los códigos anteriores (no son acumulativos).
 *   - Alerta de seguridad inmediata por email al dueño de la cuenta en cada
 *     canje exitoso, más rastro server-side en admin_action_logs -- un canje
 *     no autorizado se detecta rápido aunque no se prevenga en el momento.
 * Este endpoint es deliberadamente el mecanismo de "romper cristal" para
 * cuando el owner_admin pierde acceso a su segundo factor normal (Google) --
 * exigirle un segundo factor aquí también reintroduciría el mismo problema
 * que el mecanismo existe para resolver. El riesgo aceptado es: quien posea
 * un código de respaldo válido y no vencido obtiene la sesión sin más
 * fricción que ese código.
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
  const ip = getClientIp(request);
  const { data: rateLimitData, error: rateLimitError } = await serviceClient.rpc("check_rate_limit", {
    p_ip_address: `backup-code:${ip}`,
    p_max_requests: 8,
  });
  // Fix (auditoría externa, hallazgo CRÍTICO): antes el error del RPC ni
  // siquiera se leía -- si el RPC fallaba, rateLimitData quedaba undefined y
  // el código seguía de largo como si no hubiera límite, sobre el endpoint
  // MÁS sensible del sistema (login de owner_admin con código de respaldo).
  // Ahora se falla CERRADO, mismo patrón que el resto de check_rate_limit en
  // el repo.
  if (rateLimitError) {
    console.error("backup-codes verify check_rate_limit error:", rateLimitError.message);
    return NextResponse.json(
      { error: "Service temporarily unavailable. Try again later." },
      { status: 503 }
    );
  }
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

  // Fix (auditoría 2026-07-31, bug real confirmado): a partir de acá el código
  // ya quedó marcado `used_at` (UPDATE atómico de arriba, necesario para evitar
  // doble canje concurrente -- ver comentario de esa sección). Pero todo lo que
  // sigue (getUserById, generateLink, verifyOtp) puede fallar por razones ajenas
  // al código en sí (red, Supabase Auth caído, etc.). Si eso pasa DESPUÉS de
  // consumir el código, el owner_admin se queda sin sesión Y sin código válido
  // -- exactamente el escenario de "perdí acceso a Google" que este endpoint
  // existe para resolver. `refundConsumedCode()` revierte `used_at` a null para
  // que el código siga siendo utilizable en un reintento, preservando al mismo
  // tiempo la protección anti-doble-canje concurrente (el UPDATE original sigue
  // siendo atómico; este reembolso solo corre en el path de error, después de
  // que ya se confirmó que ESTA request fue la que ganó la carrera).
  const refundConsumedCode = async () => {
    const { error: refundError } = await serviceClient
      .from("owner_admin_backup_codes")
      .update({ used_at: null })
      .eq("id", consumed.id);
    if (refundError) {
      console.error("backup-codes verify refund error:", refundError);
    }
  };

  if (!roleRow) {
    await refundConsumedCode();
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
    await refundConsumedCode();
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
    await refundConsumedCode();
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
    await refundConsumedCode();
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
  // quedó establecida vía cookie en esta misma respuesta (ver arriba). Fix
  // (auditoría 2026-07-31, bug real confirmado): tampoco se devuelve el email
  // de la cuenta -- no aporta nada al flujo (el cliente ya sabe que el canje
  // funcionó y va a recargar con la sesión activa) y filtraba innecesariamente
  // el correo del owner_admin en la respuesta HTTP.
  return NextResponse.json({ success: true });
}

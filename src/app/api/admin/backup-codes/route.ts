import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { generateBackupCodeSet, hashBackupCode, backupCodeExpiryIso, BACKUP_CODE_COUNT } from "@/lib/backup-codes";

/**
 * v8.3 E0 — Códigos de respaldo (backup codes) de owner_admin.
 *
 * GET:  estado actual (cuántos códigos sin usar quedan, cuándo se generó el
 *       set vigente). NUNCA devuelve el código ni su hash.
 * POST: genera un set nuevo de BACKUP_CODE_COUNT códigos, invalida
 *       (revoked_at) cualquier código sin usar del set anterior, y devuelve
 *       los códigos EN TEXTO PLANO -- única vez que existen fuera de la
 *       memoria del servidor durante esta request. La UI debe dejar clarísimo
 *       que hay que guardarlos ahora (no se pueden volver a leer).
 *
 * Ambos exigen sesión ya autenticada como owner_admin (Google OAuth o email
 * OTP) vía requireAdminRole -- esto NO es un mecanismo de "olvidé mi
 * contraseña" público: solo sirve para generar códigos de respaldo mientras
 * todavía tienes acceso normal, para el día que lo pierdas.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("security_backup_codes", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("owner_admin_backup_codes")
    .select("created_at, used_at, revoked_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin/backup-codes error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const rows = data ?? [];
  const currentSetCreatedAt = rows[0]?.created_at ?? null;
  const currentSet = rows.filter((r) => r.created_at === currentSetCreatedAt);
  const unusedCount = currentSet.filter((r) => !r.used_at && !r.revoked_at).length;
  const usedCount = currentSet.filter((r) => !!r.used_at).length;

  return NextResponse.json({
    hasCodes: rows.length > 0,
    generatedAt: currentSetCreatedAt,
    totalInSet: currentSet.length,
    unusedCount,
    usedCount,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("security_backup_codes", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Invalida cualquier código sin usar del set anterior. Función
  // SECURITY DEFINER angosta (194_e0_owner_admin_backup_codes.sql) en vez de
  // una política UPDATE de RLS abierta -- ver comentario en la migración.
  const { error: revokeError } = await auth.supabase.rpc("revoke_own_unused_backup_codes");
  if (revokeError) {
    console.error("revoke_own_unused_backup_codes error:", revokeError);
    return NextResponse.json(
      { error: "No se pudo invalidar el set anterior de códigos" },
      { status: 500 }
    );
  }

  const plainCodes = generateBackupCodeSet(BACKUP_CODE_COUNT);
  // Fix (auditoría externa 2026-07-30, BUG 2): antes no se poblaba
  // expires_at (columna no existía) -- los códigos eran válidos para
  // siempre mientras no se generara un set nuevo. Ver
  // supabase/migrations/248_fix_owner_admin_backup_codes_expiry.sql.
  const expiresAt = backupCodeExpiryIso();
  const rows = plainCodes.map((code) => ({
    user_id: auth.user!.id,
    code_hash: hashBackupCode(code),
    expires_at: expiresAt,
  }));

  const { error: insertError } = await auth.supabase
    .from("owner_admin_backup_codes")
    .insert(rows);

  if (insertError) {
    console.error("owner_admin_backup_codes insert error:", insertError);
    return NextResponse.json(
      { error: "No se pudieron generar los códigos nuevos" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    codes: plainCodes,
    warning:
      "Guarda estos códigos ahora en un lugar seguro (fuera de este dispositivo si es posible). " +
      "No se van a volver a mostrar -- si los pierdes, tendrás que generar un set nuevo (lo que invalida estos).",
  });
}

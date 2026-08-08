import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";

/**
 * v8.3 fix (auditoría UX/UI/seguridad 2026-07-25, P0 #2) — los códigos de
 * respaldo (2FA recovery codes) se mostraban en texto plano sin enmascarar
 * ni registro de auditoría cuando se revelaban o copiaban (riesgo de
 * "shoulder surfing" + ningún rastro de quién vio/copió los códigos).
 *
 * Este endpoint no expone ni recibe el código en sí -- solo dispara un log
 * inmutable en admin_action_logs (vía requireAdminRole, mismo mecanismo que
 * el resto del admin) cuando la UI (admin/seguridad/page.tsx) revela un
 * código individual o copia el set completo. El pathname (.../revealed vs
 * .../copied) es lo que distingue el evento en el log, sin necesidad de
 * una columna nueva en admin_action_logs.
 */
const VALID_ACTIONS = ["revealed", "copied"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: { action: string } }
) {
  if (!VALID_ACTIONS.includes(params.action as (typeof VALID_ACTIONS)[number])) {
    return NextResponse.json({ error: "Invalid audit action" }, { status: 400 });
  }

  const auth = await requireAdminRole("security_backup_codes", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "security_backup_codes", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  // requireAdminRole ya insertó la fila en admin_action_logs (resource
  // 'security_backup_codes', method POST, path = este pathname) -- no hace
  // falta ningún insert adicional aquí.
  return NextResponse.json({ success: true });
}

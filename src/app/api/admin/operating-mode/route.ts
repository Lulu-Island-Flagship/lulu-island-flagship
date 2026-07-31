import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdminRoles, getSupabaseClient } from "@/lib/admin";
import { AUTOPILOT_MODE_FLAG_NAME } from "@/lib/autopilot-mode";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/operating-mode — v8.3 fix (auditoría 2026-07-30, item 7).
 *
 * AutopilotModeBanner.tsx (visible para TODOS los roles admin en el
 * dashboard) llamaba directo a /api/admin/feature-flags, que
 * requireAdminRole() protege con el resource "feature_flags" (solo
 * owner_admin) -- para ops_coordinator/qc_only esa llamada daba 403 y el
 * banner simplemente desaparecía (activo se quedaba en null) sin ninguna
 * explicación, en vez de mostrarse.
 *
 * Este endpoint es de solo lectura y expone ÚNICAMENTE el booleano del flag
 * de modo operativo (no la lista completa de feature flags, que sigue
 * protegida) -- accesible a cualquier usuario con al menos un rol admin
 * real (mismo criterio que admin/layout.tsx usa para conceder acceso al
 * layout), no solo owner_admin.
 */
export async function GET(_request: NextRequest) {
  const { user, roles } = await getCurrentAdminRoles();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (roles.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", AUTOPILOT_MODE_FLAG_NAME)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return safeErrorResponse(error, 500, "Ocurrió un error interno");
  }

  return NextResponse.json({ activo: data ? Boolean(data.activo) : null });
}

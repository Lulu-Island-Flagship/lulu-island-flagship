// ─── Roles de administrador (UI / Server Components) ──────────────────
//
// getCurrentAdminRoles() → lee los roles del usuario autenticado desde
//   admin_roles (vía Supabase cookies). Para Server Components y API
//   routes que necesitan saber qué roles tiene el usuario actual sin
//   pasar por el guard requireAdminRole (que es para autorización, no
//   para información). Ej: admin/page.tsx (dashboard), admin/my-roles.

import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase-client";
import { captureError } from "@/lib/observability";
import type { AdminRole } from "./admin-rbac";

// v8.3 fix G-3 (auditoría implacable 2026-07-20b): admin/layout.tsx ya
// calculaba is_supervisor() + admin_roles para filtrar AdminNav por rol,
// pero admin/page.tsx (el dashboard de 45 tarjetas) no tenía forma de
// pedir esos mismos roles sin duplicar la query a mano en cada Server
// Component que los necesite. Este helper centraliza esa lectura.
//
// Fix Kimi-A1 (auditoría externa Kimi Code, 2026-07-21, verificado y
// confirmado real): esta función tenía el mismo fallback "is_supervisor()
// sin fila en admin_roles -> tratar como ops_coordinator" eliminado.
export async function getCurrentAdminRoles(): Promise<{
  user: User | null;
  roles: AdminRole[];
}> {
  const supabase = await getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, roles: [] };
  }

  const { data: roleRows, error: roleError } = await supabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  // Fix (auditoría 2026-08-06): getCurrentAdminRoles nunca chequeaba `error`.
  // Si la query fallaba (DB caída, timeout de red, RLS), roleRows era
  // undefined y el fallback ?? [] devolvía roles vacíos en silencio — un
  // admin legítimo veía el panel vacío sin ninguna indicación de que algo
  // falló. Se loguea el error con captureError para trazabilidad; en runtime
  // se sigue devolviendo roles: [] (degradación controlada, igual que antes)
  // pero al menos queda evidencia forense.
  if (roleError) {
    captureError(roleError, { query: "admin_roles", userId: user.id });
  }

  const roles = (roleRows ?? []).map((r) => r.role as AdminRole);

  return { user, roles };
}

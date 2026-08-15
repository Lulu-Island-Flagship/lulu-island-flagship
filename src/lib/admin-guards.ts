// ─── Guardias de autorización RBAC ─────────────────────────────────────
//
// requireAdminRole(resource) → verifica sesión + rol, devuelve {supabase, user, roles}.
//   NUNCA escribe — es una guardia pura. El audit log lo hace el caller
//   explícitamente con logAdminAction().
//
// requireSupervisor() → verifica si el usuario es supervisor de campo vía
//   RPC is_supervisor(). Sin relación con admin_roles — solo control de
//   acceso a supervisor.
//
// logAdminAction(supabase, user, roles, resource, method, path)
//   → escribe UNA fila inmutable en admin_action_logs. Solo para métodos
//     de escritura (no GET/HEAD). Devuelve {error, code, status} o {error: null}.

import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase-client";
import { captureError } from "@/lib/observability";
import {
  roleAllows,
  matchingRole,
  type AdminRole,
  type AdminResource,
} from "./admin-rbac";

// ─── requireSupervisor ─────────────────────────────────────────────────

export async function requireSupervisor() {
  const supabase = await getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized", status: 401, supabase: null, user: null };
  }

  const { data: isSupervisor, error } = await supabase.rpc("is_supervisor", { user_uuid: user.id });
  if (error) {
    captureError(error, { rpc: "is_supervisor" });
    return { error: "Auth check failed", status: 500, supabase: null, user: null };
  }
  if (!isSupervisor) {
    return { error: "Forbidden — supervisor only", status: 403, supabase: null, user: null };
  }

  return { error: null, status: 200, supabase, user };
}

// ─── requireAdminRole (guardia pura — NO escribe audit log) ────────────

export async function requireAdminRole(
  resource: AdminResource,
  _request?: { method?: string; url?: string },
) {
  const supabase = await getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized", status: 401 as const, supabase: null, user: null, roles: [] as AdminRole[] };
  }

  const { data: roleRows, error } = await supabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  if (error) {
    captureError(error, { query: "admin_roles" });
    return { error: "Auth check failed", status: 500 as const, supabase: null, user: null, roles: [] as AdminRole[] };
  }

  const roles = (roleRows ?? []).map((r) => r.role as AdminRole);

  // v8.3 E0 (2026-07-11): hallazgo de auditoría externa (verificado): el
  // fallback "si no hay admin_roles pero es supervisor de campo, trátalo
  // como ops_coordinator" era un riesgo de acceso fantasma. Eliminado:
  // todo acceso administrativo con permisos por-recurso debe venir de una
  // fila explícita y auditable en admin_roles.
  if (!roleAllows(roles, resource)) {
    return { error: `Forbidden — resource '${resource}' requires a role you don't have`, status: 403 as const, supabase: null, user: null, roles };
  }

  return { error: null, status: 200 as const, supabase, user, roles };
}

// ─── logAdminAction (solo escribe audit log — NUNCA verifica) ──────────

export interface LogAdminActionParams {
  supabase: Awaited<ReturnType<typeof getSupabaseClient>>;
  user: User;
  roles: AdminRole[];
  resource: AdminResource;
  method?: string;
  path?: string;
}

export async function logAdminAction(
  params: LogAdminActionParams,
): Promise<{ error: null } | { error: string; code: "AUDIT_LOG_FAILURE"; status: 500 }> {
  const { supabase, user, roles, resource, method: rawMethod, path: rawPath } = params;
  const method = rawMethod?.toUpperCase() ?? "GET";

  // Solo se loguean escrituras; las lecturas no dejan rastro inmutable.
  if (method === "GET" || method === "HEAD") {
    return { error: null };
  }

  const authorizingRole = matchingRole(roles, resource);

  const { error: logError } = await supabase.from("admin_action_logs").insert({
    user_id: user.id,
    role_used: authorizingRole ?? roles.join(","),
    method,
    path: rawPath ? (rawPath.startsWith("/") ? rawPath : new URL(rawPath).pathname) : "unknown",
    resource,
  });

  if (logError) {
    captureError(logError, { table: "admin_action_logs" });
    return {
      error: "Audit log failed - no change was applied. Please retry; if this persists, contact an administrator.",
      code: "AUDIT_LOG_FAILURE" as const,
      status: 500 as const,
    };
  }

  return { error: null };
}

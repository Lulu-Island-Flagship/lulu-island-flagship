import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

export function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // v8.3 E0 (2026-07-11): esta función se llama tanto desde Route
        // Handlers (donde escribir cookies funciona) como desde Server
        // Components de páginas de admin (donde NO funciona y Next.js
        // truena con "Cookies can only be modified in a Server Action or
        // Route Handler"). Ignorar el error acá es el patrón oficial de
        // @supabase/ssr para ese caso -- ver mismo fix en
        // src/app/[locale]/admin/layout.tsx.
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // No-op: esperado cuando se llama desde un Server Component.
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {
            // No-op: esperado cuando se llama desde un Server Component.
          }
        },
      },
    }
  );
}

export async function requireSupervisor() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Unauthorized", status: 401, supabase: null, user: null };
  }

  const { data: isSupervisor, error } = await supabase.rpc("is_supervisor", { user_uuid: user.id });
  if (error) {
    console.error("is_supervisor RPC error:", error);
    return { error: `Auth check failed: ${error.message}`, status: 500, supabase: null, user: null };
  }
  if (!isSupervisor) {
    return { error: "Forbidden — supervisor only", status: 403, supabase: null, user: null };
  }

  return { error: null, status: 200, supabase, user };
}

// ============================================================
// v8.3 E0-C3 — Guard RBAC administrativo (M0, Fase 0.9)
// La matriz de permisos vive en src/lib/admin-rbac.ts (función pura, testeada).
// Deja log inmutable en admin_action_logs para métodos de escritura.
// ============================================================
import { roleAllows, matchingRole, type AdminRole, type AdminResource } from "./admin-rbac";

export async function requireAdminRole(
  resource: AdminResource,
  request?: { method?: string; url?: string }
) {
  const supabase = getSupabaseClient();
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
    console.error("admin_roles query error:", error);
    return { error: `Auth check failed: ${error.message}`, status: 500 as const, supabase: null, user: null, roles: [] as AdminRole[] };
  }

  const roles = (roleRows ?? []).map((r) => r.role as AdminRole);

  // v8.3 E0 (2026-07-11): hallazgo de auditoría externa (verificado): este
  // fallback ("si no hay admin_roles pero es supervisor de campo, trátalo
  // como ops_coordinator") era un riesgo de acceso fantasma -- si alguien
  // deja de ser supervisor activo pero su fila de admin_roles nunca se creó
  // (o se olvida borrar), sigue teniendo acceso administrativo implícito
  // sin que quede registrado en ningún lado que se le otorgó. Eliminado:
  // todo acceso administrativo con permisos por-recurso debe venir de una
  // fila explícita y auditable en admin_roles. Confirmado seguro de quitar:
  // las cuentas de prueba que dependían de esto (supervisor@example.com)
  // ya tienen su propia fila explícita en admin_roles (seed.sql). Un
  // supervisor de campo sin admin_roles puede seguir viendo el layout del
  // admin (is_supervisor() lo permite en layout.tsx) pero no ejecutar
  // acciones sobre recursos específicos hasta que un owner_admin le
  // asigne un rol real.

  if (!roleAllows(roles, resource)) {
    return { error: `Forbidden — resource '${resource}' requires a role you don't have`, status: 403 as const, supabase: null, user: null, roles };
  }

  // El rol específico que autorizó esta acción (no todos los que tiene el
  // usuario) -- ver matchingRole() en admin-rbac.ts.
  const authorizingRole = matchingRole(roles, resource);

  // Log de auditoría por usuario (solo escrituras; las lecturas no se loguean)
  const method = request?.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    // v8.3 E0 (2026-07-11): hallazgo de auditoría externa (verificado):
    // antes, si este insert fallaba, la acción administrativa continuaba
    // igual -- violando el invariante B.2.10 (toda escritura admin debe
    // quedar en el log inmutable). Ahora un fallo de auditoría BLOQUEA la
    // acción: preferimos negar una escritura legítima a dejar una sin
    // rastro.
    const { error: logError } = await supabase.from("admin_action_logs").insert({
      user_id: user.id,
      role_used: authorizingRole ?? roles.join(","),
      method,
      path: request?.url ? new URL(request.url).pathname : "unknown",
      resource,
    });
    if (logError) {
      console.error("admin_action_logs insert failed:", logError);
      return {
        error: "Audit log failed - action blocked for security",
        status: 500 as const,
        supabase: null,
        user: null,
        roles,
      };
    }
  }

  return { error: null, status: 200 as const, supabase, user, roles };
}

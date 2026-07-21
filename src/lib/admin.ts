import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

// v8.3 E11 (auditoría 2026-07-18): varias tablas admin-only (ej.
// financial_stress_scenario_runs, legacy_migration_checklist_items,
// gbp_checklist_items, nap_consistency_checks, employee_marketing_features
// para el lado admin) tienen políticas RLS `FOR ALL USING (false) WITH
// CHECK (false)` con el comentario "solo admins vía service role en la
// API" -- pero varios endpoints seguían usando el cliente anon+cookies de
// getSupabaseClient() (vía requireAdminRole) para las operaciones sobre
// esas tablas, así que TODAS sus lecturas/escrituras fallaban en silencio
// (RLS bloquea, no hay excepción visible). requireAdminRole() sigue siendo
// la única fuente de autorización (rol + audit log); este cliente es
// exclusivamente para las operaciones de datos una vez ya autorizado,
// mismo patrón que src/app/api/stripe/confirm/route.ts y
// src/app/api/admin/empleados/route.ts.
export function getServiceRoleClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

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

// v8.3 fix G-3 (auditoría implacable 2026-07-20b): admin/layout.tsx ya
// calculaba is_supervisor() + admin_roles para filtrar AdminNav por rol,
// pero admin/page.tsx (el dashboard de 45 tarjetas) no tenía forma de
// pedir esos mismos roles sin duplicar la query a mano en cada Server
// Component que los necesite. Este helper centraliza esa lectura (misma
// lógica exacta que admin/layout.tsx: is_supervisor() OR fila activa en
// admin_roles, con el mismo fallback a "ops_coordinator" cuando
// is_supervisor() es true pero no hay fila explícita) para que
// admin/page.tsx (y cualquier otra página admin que necesite filtrar por
// rol del lado del servidor) la reutilice en vez de reimplementarla.
export async function getCurrentAdminRoles(): Promise<{
  user: User | null;
  roles: AdminRole[];
}> {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, roles: [] };
  }

  const { data: isSupervisor } = await supabase.rpc("is_supervisor", { user_uuid: user.id });

  const { data: roleRows } = await supabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  const roles = (roleRows ?? []).map((r) => r.role as AdminRole);

  if (roles.length === 0 && isSupervisor) {
    roles.push("ops_coordinator");
  }

  return { user, roles };
}

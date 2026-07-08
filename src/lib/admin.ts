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
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
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
import { roleAllows, type AdminRole, type AdminResource } from "./admin-rbac";

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

  // Compatibilidad: un supervisor de campo activo equivale a ops_coordinator
  // hasta que el dueño migre los accesos (evita lockout durante el retrofit).
  if (roles.length === 0) {
    const { data: isSupervisor } = await supabase.rpc("is_supervisor", { user_uuid: user.id });
    if (isSupervisor) roles.push("ops_coordinator");
  }

  if (!roleAllows(roles, resource)) {
    return { error: `Forbidden — resource '${resource}' requires a role you don't have`, status: 403 as const, supabase: null, user: null, roles };
  }

  // Log de auditoría por usuario (solo escrituras; las lecturas no se loguean)
  const method = request?.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    await supabase.from("admin_action_logs").insert({
      user_id: user.id,
      role_used: roles.join(","),
      method,
      path: request?.url ? new URL(request.url).pathname : "unknown",
      resource,
    });
  }

  return { error: null, status: 200 as const, supabase, user, roles };
}

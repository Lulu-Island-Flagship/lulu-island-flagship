// v8.3 fix CRÍTICO (auditoría implacable "Autenticación de entrada",
// 2026-07-26): ninguna API bajo /api/empleado/** verificaba que el empleado
// autenticado siguiera activo (employees.is_active = true) ni que no
// estuviera dado de baja (employees.deleted_at IS NULL) al resolver
// user_id -> employee. El patrón repetido en ~30 endpoints era:
//
//   .from("employees").select("id").eq("user_id", user.id).single()
//
// sin ningún filtro de estado. Un empleado desactivado u offboarded podía
// seguir usando TODAS las APIs de empleado mientras su sesión/cookie de
// Supabase siguiera viva (hasta 1h + refresh token silencioso), incluyendo
// fichaje de horas, cierres de servicio, votaciones, disputas de nómina,
// etc. Este helper centraliza la única forma correcta de resolver
// user_id -> employee para estas rutas, y reemplaza la consulta manual.
//
// Nunca revela si el user_id existe o no en `employees` -- tanto "no existe
// fila" como "existe pero inactivo/borrado" devuelven el mismo error
// genérico y el mismo status 403, para no filtrar detalles internos a un
// llamador no autorizado.

// Fix (auditoría 2026-07-31, severidad media): antes `SupabaseLike` era un
// alias directo de `any`. Mismo patrón que el resto del proyecto usa para
// clientes sin tipos de schema generados (ver src/lib/client-module/*.ts,
// src/lib/staff-login.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = SupabaseClient<any, "public", any>;

export interface RequireActiveEmployeeResult<T> {
  employee: T | null;
  error: string | null;
  status: 200 | 403 | 500;
}

const GENERIC_ERROR = "Employee profile not found or inactive";
const INFRA_ERROR = "Could not verify employee status";

/**
 * Resuelve un `user_id` autenticado a su fila de `employees`, exigiendo
 * `is_active = true` y `deleted_at IS NULL`. Usar en TODAS las rutas bajo
 * src/app/api/empleado/** en vez de consultar `employees` directamente.
 *
 * @param supabase Cliente Supabase ya autenticado (cookies del request).
 * @param userId `user.id` obtenido de `supabase.auth.getUser()`.
 * @param select Columnas a seleccionar de `employees` (por defecto solo
 *   "id"; pasar un select más amplio, ej. "id, name", si la ruta ya
 *   necesitaba esos campos antes de este fix).
 */
export async function requireActiveEmployee<T = { id: string }>(
  supabase: SupabaseLike,
  userId: string,
  select: string = "id"
): Promise<RequireActiveEmployeeResult<T>> {
  const { data: employee, error } = await supabase
    .from("employees")
    .select(select)
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .single();

  if (error) {
    // Fix (auditoría 2026-07-31, hallazgo confirmado): antes CUALQUIER error
    // de Supabase (red, timeout, RLS mal configurado, connection pool
    // agotado, etc.) caía en el mismo 403 genérico que "empleado no
    // encontrado/inactivo". Eso no filtraba información sensible (el mensaje
    // seguía siendo el mismo GENERIC_ERROR, así que el invariante de "nunca
    // revela si el user_id existe" documentado arriba se mantiene intacto),
    // pero SÍ era engañoso operacionalmente: un empleado activo real, ante un
    // fallo transitorio de infraestructura, recibía un mensaje que sugiere
    // "tu cuenta no existe o está inactiva" cuando el problema real era que
    // el sistema ni siquiera pudo consultar. PGRST116 (PostgREST) es el
    // código específico de "no rows returned" -- ese SÍ es el caso normal de
    // "no matchea is_active=true/deleted_at IS NULL" y se mantiene como 403.
    // Cualquier otro código es un fallo real de infraestructura: se distingue
    // con 500 y un mensaje propio (tampoco revela nada sobre el user_id).
    if (error.code !== "PGRST116") {
      console.error("requireActiveEmployee query error:", error);
      return { employee: null, error: INFRA_ERROR, status: 500 };
    }
    return { employee: null, error: GENERIC_ERROR, status: 403 };
  }

  if (!employee) {
    return { employee: null, error: GENERIC_ERROR, status: 403 };
  }

  return { employee: employee as T, error: null, status: 200 };
}

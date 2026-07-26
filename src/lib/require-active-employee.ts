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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export interface RequireActiveEmployeeResult<T> {
  employee: T | null;
  error: string | null;
  status: 200 | 403;
}

const GENERIC_ERROR = "Employee profile not found or inactive";

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

  if (error || !employee) {
    return { employee: null, error: GENERIC_ERROR, status: 403 };
  }

  return { employee: employee as T, error: null, status: 200 };
}

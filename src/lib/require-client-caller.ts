// Fix (pentest autorizado, 2026-08-02, hallazgo confirmado): las rutas bajo
// src/app/api/client/** verificaban que hubiera un usuario autenticado
// (`supabase.auth.getUser()`) pero NUNCA verificaban que ese usuario fuera
// en realidad un cliente. Confirmado en GET /api/client/orders: un empleado
// o un admin (ops_coordinator) autenticado podía llamar la ruta y recibir
// 200 en vez de 403 -- el filtro `.eq("user_id", user.id)` sobre `orders`
// solo limita QUÉ filas ve, nunca rechaza al llamador por su rol. Hoy no
// hay impacto observable porque las cuentas de prueba no tienen fila en
// `clients` para ese user_id, pero si algún día un empleado o admin
// también termina con una fila de `clients` ligada al mismo `user_id`
// (ej. flujo de reserva telefónica, o cualquier flujo futuro), vería datos
// privados de ese cliente a través de una ruta que nunca debió autorizarlo.
//
// Mismo patrón defensivo que ya existía para el lado admin
// (requireAdminRole en src/lib/admin.ts, consulta admin_roles) y para el
// lado empleado (requireActiveEmployee en
// src/lib/require-active-employee.ts, consulta employees) -- pero en
// dirección inversa: aquí NO se exige que exista una fila en `clients`
// (varias rutas de cliente no la necesitan, ej. las que filtran
// directamente por `orders.user_id`), se exige que NO exista una fila
// activa en `employees` ni en `admin_roles` para ese `user_id`. Un
// empleado/admin legítimo debe usar las rutas de /api/employee/** o
// /api/admin/** -- nunca las de /api/client/**, sin importar si además
// tiene o no una fila en `clients`.
//
// Igual que requireActiveEmployee, nunca revela CUÁL de las dos tablas
// disparó el rechazo -- mismo mensaje genérico y mismo status 403 en
// ambos casos, para no filtrar detalles internos de rol a un llamador no
// autorizado.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureError } from "@/lib/observability";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = SupabaseClient<any, "public", any>;

export interface RequireClientCallerResult {
  ok: boolean;
  error: string | null;
  status: 200 | 403 | 500;
}

const GENERIC_ERROR = "Forbidden — this endpoint is only available to clients";
const INFRA_ERROR = "Could not verify caller role";

/**
 * Rechaza (403) a cualquier llamador autenticado que tenga una fila activa
 * en `employees` (is_active = true, deleted_at IS NULL) o en `admin_roles`
 * (deleted_at IS NULL). Usar en TODAS las rutas bajo src/app/api/client/**
 * ANTES de cualquier consulta que dependa de la propiedad del recurso —
 * mismo espíritu defensivo que requireActiveEmployee() en
 * src/lib/require-active-employee.ts, pero verificando la AUSENCIA de rol
 * de staff en vez de la presencia de un rol específico.
 *
 * @param supabase Cliente Supabase ya autenticado (cookies del request).
 * @param userId `user.id` obtenido de `supabase.auth.getUser()`.
 */
export async function requireClientCaller(
  supabase: SupabaseLike,
  userId: string
): Promise<RequireClientCallerResult> {
  const [employeeResult, adminRoleResult] = await Promise.all([
    supabase
      .from("employees")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("admin_roles")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);

  if (employeeResult.error) {
    captureError(employeeResult.error, { fn: "requireClientCaller.employees" });
    return { ok: false, error: INFRA_ERROR, status: 500 };
  }
  if (adminRoleResult.error) {
    captureError(adminRoleResult.error, { fn: "requireClientCaller.admin_roles" });
    return { ok: false, error: INFRA_ERROR, status: 500 };
  }

  if (employeeResult.data || adminRoleResult.data) {
    return { ok: false, error: GENERIC_ERROR, status: 403 };
  }

  return { ok: true, error: null, status: 200 };
}

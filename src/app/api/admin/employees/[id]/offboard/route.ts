import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { getVancouverTodayString } from "@/lib/date-utils";
import { isValidUuid } from "@/lib/validation";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/admin/empleados/[id]/offboard — FIX-11: offboarding real.
 *
 * v8.3 hallazgo de auditoría de ciclo de vida del empleado: ningún endpoint
 * en todo el sistema ponía employees.is_active en false -- no existía forma
 * de dar de baja a un empleado desde el producto (análogo al hallazgo de
 * FIX-10 con onboarding). Este endpoint hace las 4 cosas que el "último día"
 * de un empleado real requiere, en una sola transacción de aplicación:
 *
 *   1. Desactivación: employees.is_active=false, terminated_at, termination_reason.
 *      Se ejecuta PRIMERO (no al final): no hay una transacción real que
 *      envuelva los 4 pasos (son varias llamadas a Supabase desde la API
 *      route, no una RPC atómica), así que si un paso posterior falla a
 *      mitad de camino, el fallo seguro es que el empleado quede desactivado
 *      (bloquea dispatch/login) aunque algún pago o reasignación no se haya
 *      completado -- nunca al revés (pagado/desvinculado de servicios pero
 *      todavía activo en el sistema).
 *   2. Pago final: paga el Vacation Pay acumulado sin pagar de TODOS los años
 *      calendario abiertos en payroll_ytd (migración 052), no solo el año en
 *      curso. Bajo BC ESA el Vacation Pay acumulado nunca prescribe: si la
 *      baja ocurre en enero y quedó un saldo del año anterior nunca
 *      liquidado (no existe un proceso de cierre de año que lo funda o lo
 *      pague), ese saldo se debe. Vía employee_final_payouts (migración
 *      177), que payroll-export ya funde al ciclo (mismo patrón que sick
 *      leave / stat holiday de FIX-4).
 *   3. Revocación de acceso: banea la cuenta auth (Supabase admin API) --
 *      is_active=false ya bloquea el dispatch, pero no bloqueaba el login
 *      ni la sesión activa de la PWA.
 *   4. Reasignación: los servicios futuros ya asignados a este empleado
 *      (orders.service_date >= hoy, no completados) se sueltan (soft-delete
 *      de la fila en `assignments`) para que dispatch-scheduler los vuelva a
 *      proponer con otro equipo la próxima vez que corra para esa fecha, y
 *      deja un ticket en la bandeja unificada para que el admin no dependa
 *      solo del cron si la fecha es próxima.
 *
 * Body: { terminationReason: string, terminationDate?: string (YYYY-MM-DD, default hoy) }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("employees_admin", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "employees_admin", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const employeeId = params.id;

    // Fix (auditoría de integridad de datos 2026-08-01): params.id no se
    // validaba como UUID antes de usarse contra employees/payroll_ytd/etc.
    if (!isValidUuid(employeeId)) {
      return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
    }

    const body = await request.json();
    const { terminationReason, terminationDate } = body as {
      terminationReason?: unknown;
      terminationDate?: unknown;
    };

    if (typeof terminationReason !== "string" || !terminationReason.trim()) {
      return NextResponse.json({ error: "terminationReason is required" }, { status: 400 });
    }

    const supabase = auth.supabase;
    const todayIso = getVancouverTodayString();
    const effectiveDate = typeof terminationDate === "string" ? terminationDate : todayIso;

    const { data: employee, error: employeeError } = await supabase
      .from("employees")
      .select("id, user_id, is_active, terminated_at")
      .eq("id", employeeId)
      .is("deleted_at", null)
      .single();

    if (employeeError || !employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    if (employee.terminated_at) {
      return NextResponse.json({ error: "Employee already offboarded" }, { status: 409 });
    }

    // Fix (auditoría de integridad de datos 2026-08-01): los pasos 1
    // (desactivación), 2 (pago final Vacation Pay) y 4 (liberar servicios
    // futuros) eran 3+ llamadas REST sueltas -- si una fallaba a mitad de
    // camino, el empleado podía quedar desactivado sin su pago final
    // registrado, o con solo una parte de sus servicios liberados. Ahora
    // son una sola llamada RPC (migración 305) atómica: o los tres pasos
    // committean juntos, o ninguno lo hace. El paso 3 (revocar acceso Auth)
    // sigue siendo una llamada a un servicio EXTERNO fuera de esta
    // transacción SQL por diseño -- se ejecuta DESPUÉS, de forma no
    // bloqueante, exactamente como documentaba la versión anterior de este
    // endpoint (la desactivación debe quedar aplicada aunque el ban de Auth
    // falle, nunca al revés).
    const { data: rpcResult, error: rpcError } = await supabase.rpc("offboard_employee_atomic", {
      p_employee_id: employeeId,
      p_termination_reason: terminationReason.trim(),
      p_effective_date: effectiveDate,
      p_admin_id: auth.user.id,
    });

    if (rpcError) {
      console.error("admin/empleados/[id]/offboard error:", rpcError);
      if (rpcError.message?.includes("EMPLOYEE_NOT_FOUND")) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }
      if (rpcError.message?.includes("EMPLOYEE_ALREADY_OFFBOARDED")) {
        return NextResponse.json({ error: "Employee already offboarded" }, { status: 409 });
      }
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const result = rpcResult as {
      employeeId: string;
      userId: string | null;
      vacationPayoutCents: number;
      reassignedCount: number;
      affectedOrders: { orderId: string; serviceDate: string }[];
      inProgressOrders: { orderId: string; serviceDate: string; status: string }[];
    };

    // --- 3. Revocación de acceso: banear la cuenta auth (servicio externo,
    // fuera de la transacción SQL de arriba -- ver comentario de cabecera). ---
    let accessRevoked = false;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseServiceKey && result.userId) {
      const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);
      // ~10 años -- Supabase no tiene un "ban permanente" real, este es el
      // equivalente práctico. Reversible por un owner_admin si se re-contrata.
      const { error: banError } = await adminSupabase.auth.admin.updateUserById(result.userId, {
        ban_duration: "87600h",
      });
      if (!banError) accessRevoked = true;
      else console.error("Offboarding: failed to revoke auth access:", banError);
    }

    const { data: updatedEmployee } = await supabase
      .from("employees")
      .select("id, name, email, is_active, terminated_at, termination_reason")
      .eq("id", employeeId)
      .single();

    return NextResponse.json(
      {
        employee: updatedEmployee,
        vacationPayoutCents: result.vacationPayoutCents,
        accessRevoked,
        reassignedCount: result.reassignedCount,
        affectedOrders: result.affectedOrders,
        inProgressOrders: result.inProgressOrders,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

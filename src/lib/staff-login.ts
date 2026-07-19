/**
 * v8.3 — Portal de equipo unificado (login staff).
 *
 * Antes de esto, AdminLoginScreen (src/components/admin/AdminLoginScreen.tsx)
 * y EmployeeAuthModal (src/components/empleado/EmployeeAuthModal.tsx) eran
 * dos pantallas de login independientes, cada una con su propia autorización
 * "hardcoded" a un solo destino (/admin o /empleado). Ninguna sabía nada de
 * la otra, y ninguna vinculaba automáticamente employees.user_id en el
 * primer login de un empleado invitado.
 *
 * Este módulo es la ÚNICA fuente de verdad de "¿quién es este usuario ya
 * autenticado con Google, y a dónde debe ir?" para /portal
 * (src/app/[locale]/portal/page.tsx vía /api/staff/resolve-login).
 *
 * Invariante de seguridad (obligatorio, ver tarea): NUNCA se crea una fila
 * nueva en `employees` ni en `admin_roles` desde aquí. Solo se lee, y en el
 * único caso de "primer login de empleado invitado" se VINCULA (UPDATE) un
 * user_id a una fila de employees que el manager ya creó de antemano — y
 * solo si esa fila todavía no tiene user_id (WHERE user_id IS NULL,
 * atómico), para que un segundo intento de reclamo con otra cuenta no pueda
 * pisar el vínculo ya hecho.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

export type StaffArea = "empleado" | "admin" | "qc";

export type StaffLoginResult =
  | { authorized: true; area: StaffArea; employeeLinkedNow: boolean }
  | { authorized: false; reason: "not_registered" | "pending_activation" };

const ADMIN_ROLE_PRIORITY = ["owner_admin", "ops_coordinator", "qc_only"] as const;

/**
 * Resuelve el destino de un usuario ya autenticado (Google OAuth, sesión
 * válida) contra employees + admin_roles, usando un cliente con service
 * role (RLS de employees/admin_roles no permite que un usuario recién
 * autenticado se auto-vincule vía el cliente anon — ver migración 181).
 */
export async function resolveStaffLogin(
  serviceSupabase: ServiceClient,
  userId: string,
  email: string | null | undefined
): Promise<StaffLoginResult> {
  // 1. ¿Ya hay una fila de employees vinculada a este user_id? (caso normal
  //    tras el primer login, o empleado invitado vía
  //    supabase.auth.admin.inviteUserByEmail que ya trae user_id desde la
  //    creación -- ver POST /api/admin/empleados).
  const { data: byUserId } = await serviceSupabase
    .from("employees")
    .select("id, is_active")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (byUserId) {
    return byUserId.is_active
      ? { authorized: true, area: "empleado", employeeLinkedNow: false }
      : { authorized: false, reason: "pending_activation" };
  }

  // 2. Primer login real de un empleado invitado cuyo user_id todavía no
  //    coincide con ningún registro (ej. la cuenta invitada nunca aceptó el
  //    link de invitación y en vez de eso entró directo por "Sign in with
  //    Google" con el mismo correo, creando una identidad distinta en
  //    auth.users). Coincidencia SOLO por email exacto (normalizado),
  //    nunca por nombre ni por ninguna otra heurística.
  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    const { data: byEmail } = await serviceSupabase
      .from("employees")
      .select("id, is_active, user_id")
      .eq("email", normalizedEmail)
      .is("user_id", null)
      .is("deleted_at", null)
      .maybeSingle();

    if (byEmail) {
      // UPDATE atómico condicionado a user_id IS NULL: si dos requests
      // concurrentes (o un segundo intento de otra cuenta con el mismo
      // email histórico) corren esta misma función, solo UNA puede ganar
      // la carrera -- la segunda no encuentra fila con user_id IS NULL y
      // cae a "not_registered" más abajo.
      const { data: linked } = await serviceSupabase
        .from("employees")
        .update({ user_id: userId })
        .eq("id", byEmail.id)
        .is("user_id", null)
        .select("id, is_active")
        .maybeSingle();

      if (linked) {
        return linked.is_active
          ? { authorized: true, area: "empleado", employeeLinkedNow: true }
          : { authorized: false, reason: "pending_activation" };
      }
      // Perdió la carrera de vinculación -- sigue de largo a admin_roles y,
      // si tampoco hay nada ahí, termina en not_registered.
    }
  }

  // 3. Roles administrativos (owner_admin / ops_coordinator / qc_only).
  //    admin_roles.user_id se asigna a mano por un owner_admin ya existente
  //    (no hay columna email -- ver migración 040) y nunca se crea aquí.
  const { data: roleRows } = await serviceSupabase
    .from("admin_roles")
    .select("role")
    .eq("user_id", userId)
    .is("deleted_at", null);

  const roles = new Set((roleRows ?? []).map((r: { role: string }) => r.role));
  for (const role of ADMIN_ROLE_PRIORITY) {
    if (roles.has(role)) {
      return {
        authorized: true,
        area: role === "qc_only" ? "qc" : "admin",
        employeeLinkedNow: false,
      };
    }
  }

  // 4. Ni employees ni admin_roles lo reconocen -- rechazo explícito.
  //    Invariante obligatoria: NUNCA se crea cuenta/registro nuevo aquí.
  return { authorized: false, reason: "not_registered" };
}

export const STAFF_UNAUTHORIZED_MESSAGE =
  "Tu cuenta no está autorizada. Si eres empleado o parte del equipo administrativo, contacta al manager.";

export const STAFF_PENDING_ACTIVATION_MESSAGE =
  "Tu cuenta de empleado todavía no ha sido activada. Contacta al manager para completar tu aprobación.";

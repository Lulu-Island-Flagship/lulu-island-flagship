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

// Fix (auditoría 2026-07-31, severidad media): antes `ServiceClient` era un
// alias directo de `any` (perdía TODO el tipado, incluido el de los métodos
// encadenados .from()/.select()/etc.). El resto del proyecto usa el patrón
// `SupabaseClient<any, "public", any>` para estos casos (ver
// src/lib/client-module/*.ts, src/lib/send-communication.ts) -- no es tipado
// completo de schema (seguiría requiriendo los tipos generados de Supabase),
// pero sí reconoce la forma real del cliente en vez de aceptar cualquier cosa.
import type { SupabaseClient } from "@supabase/supabase-js";
type ServiceClient = SupabaseClient;

export type StaffArea = "employee" | "admin" | "qc";

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
  email: string | null | undefined,
  options?: { readOnly?: boolean }
): Promise<StaffLoginResult> {
  // Fix (auditoría 2026-07-31, hallazgo confirmado): esta función SIEMPRE
  // hacía el UPDATE de vinculación del paso 3 (employees.user_id) cuando
  // corría la rama de "primer login por email". Eso era correcto para su
  // caller original (/api/staff/resolve-login, un POST cuyo propósito
  // explícito es ese), pero src/app/api/account/access-check/route.ts -- un
  // GET que solo quiere saber "¿es este usuario staff?" para decidir si
  // mostrarle el layout de cliente -- reutilizaba esta misma función y de
  // paso mutaba employees.user_id como efecto secundario de una simple
  // consulta de lectura. `readOnly: true` desactiva SOLO ese UPDATE (ver
  // paso 3 abajo); el resto de la lógica de lectura es idéntica.
  const readOnly = options?.readOnly === true;
  // 1. Roles administrativos (owner_admin / ops_coordinator / qc_only)
  //    PRIMERO, antes de mirar `employees` en absoluto.
  //
  //    Fix (auditoría externa, hallazgo confirmado): esta función solía
  //    revisar `employees` primero y recién en tercer lugar `admin_roles`.
  //    Eso permitía que un owner_admin cuyo email coincidiera con una fila
  //    de `employees` invitada-pero-nunca-reclamada (user_id IS NULL) se
  //    vinculara automáticamente como empleado en su primer login (ver
  //    paso 3 más abajo) y quedara atrapado en /empleado para siempre --
  //    employees.user_id ya no es NULL, así que el WHERE user_id IS NULL
  //    del paso 3 nunca vuelve a encontrar esa fila, y como el paso 2
  //    (employees por user_id) corría antes que este, el rol admin real
  //    nunca se llegaba a consultar. admin_roles.user_id se asigna a mano
  //    por un owner_admin ya existente (no hay columna email -- ver
  //    migración 040) y nunca se crea aquí, así que consultarlo primero no
  //    tiene ningún efecto secundario ni riesgo de auto-vinculación
  //    indebida -- solo cambia el ORDEN de prioridad quede: admin primero.
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

  // 2. ¿Ya hay una fila de employees vinculada a este user_id? (caso normal
  //    tras el primer login, o empleado invitado vía
  //    supabase.auth.admin.inviteUserByEmail que ya trae user_id desde la
  //    creación -- ver POST /api/admin/empleados).
  //
  //    CONSOLIDACIÓN (2026-08-06, auditoría "Esponja"): este check de
  //    "empleado activo" es estructuralmente similar al de
  //    requireActiveEmployee() en src/lib/require-active-employee.ts, pero
  //    NO puede delegar en esa función por tres razones:
  //
  //    a) Cliente distinto: resolveStaffLogin() opera con serviceSupabase
  //       (service_role, bypassea RLS), mientras que requireActiveEmployee()
  //       espera un cliente autenticado como el usuario (RLS activo). Pasarle
  //       el service_role haría que la función se comporte de forma
  //       impredecible (RLS de employees no restringe al service_role, pero
  //       el contrato de requireActiveEmployee asume un cliente de usuario).
  //
  //    b) Semántica de error distinta: requireActiveEmployee() colapsa
  //       "no existe fila" y "existe pero inactivo" en un solo error
  //       genérico (GENERIC_ERROR / 403). resolveStaffLogin() NECESITA
  //       distinguir ambos casos: "inactivo" → pending_activation (el
  //       empleado existe pero el manager no lo ha activado todavía),
  //       mientras que "no existe" → cae al paso 3 (intentar vinculación
  //       por email).
  //
  //    c) maybeSingle() vs single(): requireActiveEmployee() usa .single()
  //       (lanza PGRST116 si 0 filas) y tiene lógica compleja de distinción
  //       de códigos de error. resolveStaffLogin() usa .maybeSingle() porque
  //       "0 filas" es un resultado esperado y no un error.
  const { data: byUserId } = await serviceSupabase
    .from("employees")
    .select("id, is_active")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (byUserId) {
    return byUserId.is_active
      ? { authorized: true, area: "employee", employeeLinkedNow: false }
      : { authorized: false, reason: "pending_activation" };
  }

  // 3. Primer login real de un empleado invitado cuyo user_id todavía no
  //    coincide con ningún registro (ej. la cuenta invitada nunca aceptó el
  //    link de invitación y en vez de eso entró directo por "Sign in with
  //    Google" con el mismo correo, creando una identidad distinta en
  //    auth.users). Coincidencia SOLO por email exacto (normalizado),
  //    nunca por nombre ni por ninguna otra heurística.
  //
  //    A esta altura ya sabemos (paso 1) que este userId NO tiene ningún
  //    admin_roles activo, así que vincularlo aquí como empleado no puede
  //    secuestrar una cuenta admin.
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
      if (readOnly) {
        // Modo solo-lectura (ver comentario de cabecera de la función): se
        // responde con el mismo veredicto que tendría la vinculación real,
        // pero SIN ejecutar el UPDATE -- employees.user_id se queda como
        // estaba. La vinculación real de verdad solo ocurre cuando esta
        // función se llama desde /api/staff/resolve-login (readOnly
        // ausente/false).
        return byEmail.is_active
          ? { authorized: true, area: "employee", employeeLinkedNow: false }
          : { authorized: false, reason: "pending_activation" };
      }

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
          ? { authorized: true, area: "employee", employeeLinkedNow: true }
          : { authorized: false, reason: "pending_activation" };
      }
      // Perdió la carrera de vinculación -- termina en not_registered abajo
      // (admin_roles ya se descartó en el paso 1).
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

/**
 * v8.3 E0-C3 — RBAC administrativo (M0, Fase 0.9)
 *
 * Tres roles ADMINISTRATIVOS (separados de los roles de campo en employees.role):
 *   owner_admin     — todo
 *   ops_coordinator — despacho, tickets, QC, servicios — SIN finanzas ni nómina
 *   qc_only         — muro de fotos QC, nada más
 *
 * La matriz vive aquí como única fuente de verdad y es una función pura,
 * verificable con tests sin base de datos.
 */

export type AdminRole = "owner_admin" | "ops_coordinator" | "qc_only";

export type AdminResource =
  // Finanzas / nómina / configuración económica — SOLO owner_admin
  | "pricing_settings"
  | "pricing_rules"
  | "hhe_settings"
  | "payroll"
  | "employees_admin" // contiene Day Rate y datos de nómina
  | "finance"
  | "compliance" // PIPEDA, brechas de datos, monitoreo legal — solo el dueño
  | "feature_flags" // interruptores del sistema — solo el dueño
  | "security_backup_codes" // códigos de respaldo 2FA del propio owner_admin — solo el dueño
  | "access_recovery" // aprobar/denegar solicitudes de recuperación de acceso de trusted_successors — solo el dueño
  // Operación — owner_admin + ops_coordinator
  | "dispatch"
  | "services"
  | "quotes_review"
  | "tickets"
  | "upsells_review"
  | "checklists_sop"
  | "vehicles"
  | "field_audits"
  | "risk_assessments"
  | "near_misses"
  | "inventory"
  | "wellbeing"
  | "teams" // v8.3 E8 FIX-6: CRUD de equipos (identidad mínima, migración 099)
  | "phone_booking" // v8.3 E6.6: reserva por teléfono (coordinador reusa el cotizador real)
  // QC — owner_admin + ops_coordinator + qc_only
  | "qc_wall";

const MATRIX: Record<AdminResource, AdminRole[]> = {
  pricing_settings: ["owner_admin"],
  pricing_rules: ["owner_admin"],
  hhe_settings: ["owner_admin"],
  payroll: ["owner_admin"],
  employees_admin: ["owner_admin"],
  finance: ["owner_admin"],
  compliance: ["owner_admin"],
  feature_flags: ["owner_admin"],
  security_backup_codes: ["owner_admin"],
  access_recovery: ["owner_admin"],
  dispatch: ["owner_admin", "ops_coordinator"],
  services: ["owner_admin", "ops_coordinator"],
  quotes_review: ["owner_admin", "ops_coordinator"],
  tickets: ["owner_admin", "ops_coordinator"],
  upsells_review: ["owner_admin", "ops_coordinator"],
  checklists_sop: ["owner_admin", "ops_coordinator"],
  vehicles: ["owner_admin", "ops_coordinator"],
  field_audits: ["owner_admin", "ops_coordinator"],
  risk_assessments: ["owner_admin", "ops_coordinator"],
  near_misses: ["owner_admin", "ops_coordinator"],
  inventory: ["owner_admin", "ops_coordinator"],
  wellbeing: ["owner_admin", "ops_coordinator"],
  teams: ["owner_admin", "ops_coordinator"],
  phone_booking: ["owner_admin", "ops_coordinator"],
  qc_wall: ["owner_admin", "ops_coordinator", "qc_only"],
};

/** Función pura: ¿alguno de los roles del usuario permite el recurso? */
export function roleAllows(roles: AdminRole[], resource: AdminResource): boolean {
  const allowed = MATRIX[resource];
  return roles.some((r) => allowed.includes(r));
}

// v8.3 E0 (2026-07-11): hallazgo de auditoría externa (verificado): el log
// de admin_action_logs guardaba TODOS los roles del usuario
// (roles.join(",")), no cuál de ellos autorizó de verdad la acción. Si un
// usuario tiene dos roles (ej: ops_coordinator y qc_only) y hay un
// incidente, el log no dice bajo cuál permiso se permitió -- y si hubiera
// un bug en la matriz que permita algo por error, el log no ayuda a
// encontrarlo. Esta función devuelve el rol específico que efectivamente
// coincide con el recurso, para que admin.ts lo registre en vez del CSV
// completo.
export function matchingRole(roles: AdminRole[], resource: AdminResource): AdminRole | null {
  const allowed = MATRIX[resource];
  return roles.find((r) => allowed.includes(r)) ?? null;
}

/** Recursos permitidos para un conjunto de roles (para UI de navegación). */
export function allowedResources(roles: AdminRole[]): AdminResource[] {
  return (Object.keys(MATRIX) as AdminResource[]).filter((res) =>
    roleAllows(roles, res)
  );
}

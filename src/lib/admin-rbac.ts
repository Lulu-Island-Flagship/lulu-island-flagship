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
  | "admin_roles_management" // v8.3 fix B-2 (auditoría 2026-07-20): alta/revocación de owner_admin/ops_coordinator/qc_only — solo el dueño, nunca delegable
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
  // Publicación pública de marketing (fotos del cliente en el sitio) —
  // v8.3 fix C-H2 (auditoría RBAC 2026-07-21): separado de "qc_wall" porque
  // qc_wall es revisión de calidad interna y este es publicar contenido de
  // la casa de un cliente en el sitio público. qc_only NO debe tener esto.
  | "live_portfolio_publish"
  // Hiring / recruitment — owner_admin + ops_coordinator
  | "applicants"

  // QC — owner_admin + ops_coordinator + qc_only
  | "qc_wall"
  // Client management — owner_admin + ops_coordinator
  | "clients"
  // Site content management (landing page text/images) — owner_admin + ops_coordinator
  | "site_content"
  | "site_content_images"
  // Dashboard counts — all admin roles
  | "dashboard";

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
  admin_roles_management: ["owner_admin"],
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
  // v8.3 fix C-H2: publicar en el muro público es marketing, no QC. qc_only
  // (el rol de menor privilegio) NO debe poder publicar fotos de la casa de
  // un cliente en el sitio público.
  live_portfolio_publish: ["owner_admin", "ops_coordinator"],
  applicants: ["owner_admin", "ops_coordinator"],
  clients: ["owner_admin", "ops_coordinator"],
  dashboard: ["owner_admin", "ops_coordinator"],
  site_content: ["owner_admin", "ops_coordinator"],
  site_content_images: ["owner_admin", "ops_coordinator"],
  qc_wall: ["owner_admin", "ops_coordinator", "qc_only"],
};

/** Función pura: ¿alguno de los roles del usuario permite el recurso? */
export function roleAllows(roles: AdminRole[], resource: AdminResource): boolean {
  // Fix (auditoría 2026-07-30, item 9): MATRIX[resource] puede ser
  // `undefined` si se pasa un resource que no existe en la matriz (ej. un
  // typo o un valor no validado por TypeScript en tiempo de ejecución) --
  // `.includes` sobre `undefined` tronaba con TypeError. `?? []` hace que un
  // resource desconocido simplemente no autorice a nadie, en vez de romper.
  const allowed = MATRIX[resource] ?? [];
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
  // Mismo fix que roleAllows() arriba: resource desconocido no debe tronar.
  const allowed = MATRIX[resource] ?? [];
  return roles.find((r) => allowed.includes(r)) ?? null;
}

/** Recursos permitidos para un conjunto de roles (para UI de navegación). */
export function allowedResources(roles: AdminRole[]): AdminResource[] {
  return (Object.keys(MATRIX) as AdminResource[]).filter((res) =>
    roleAllows(roles, res)
  );
}

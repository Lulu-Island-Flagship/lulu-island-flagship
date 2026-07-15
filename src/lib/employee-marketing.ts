/**
 * v8.3 E10.8 — Marketing de empleados (reels "un día en la vida" + insignias
 * públicas en el sitio). Lógica pura del flujo de consentimiento +
 * aprobación de un toque.
 *
 * Regla central: la visibilidad pública depende de TRES condiciones, todas
 * necesarias — el empleado consintió, el admin aprobó, y el consentimiento
 * no fue retirado después. Si cualquiera falta, no es visible. El orden en
 * que ocurren no importa (aprobar antes de que el empleado consienta es
 * inválido igual que consentir sin aprobación admin).
 */

export type EmployeeMarketingFeatureType = "day_in_life_reel" | "public_badge_showcase";

export interface EmployeeMarketingFeature {
  employeeConsentedAt: string | null;
  employeeConsentWithdrawnAt: string | null;
  adminApprovedAt: string | null;
}

export type EmployeeMarketingVisibility =
  | "not_visible_awaiting_consent"
  | "not_visible_awaiting_admin_approval"
  | "not_visible_consent_withdrawn"
  | "visible";

/**
 * ¿Es públicamente visible este feature de marketing de empleado, dado su
 * estado actual? Pura, sin acceso a DB ni reloj.
 */
export function evaluateEmployeeMarketingVisibility(
  feature: EmployeeMarketingFeature
): EmployeeMarketingVisibility {
  // El retiro de consentimiento SIEMPRE gana, sin importar si fue después
  // de la aprobación admin — un empleado puede arrepentirse en cualquier
  // momento y eso despublica de inmediato.
  if (feature.employeeConsentWithdrawnAt) {
    return "not_visible_consent_withdrawn";
  }
  if (!feature.employeeConsentedAt) {
    return "not_visible_awaiting_consent";
  }
  if (!feature.adminApprovedAt) {
    return "not_visible_awaiting_admin_approval";
  }
  return "visible";
}

/** ¿Puede el admin aprobar este feature ahora mismo? Requiere consentimiento vigente. */
export function canAdminApprove(feature: EmployeeMarketingFeature): { allowed: boolean; reason?: string } {
  if (feature.employeeConsentWithdrawnAt) {
    return { allowed: false, reason: "El empleado retiró su consentimiento" };
  }
  if (!feature.employeeConsentedAt) {
    return { allowed: false, reason: "El empleado aún no ha dado su consentimiento" };
  }
  return { allowed: true };
}

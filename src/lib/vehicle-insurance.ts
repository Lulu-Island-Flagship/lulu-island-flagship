/**
 * v8.3 E7 — Espejo en aplicación de la regla de seguro vencido (la fuente de
 * verdad real es el trigger SQL `prevent_expired_vehicle_assignment`, migración
 * 047). Esta función pura existe para que el admin UI pueda avisar ANTES de
 * intentar guardar (mejor experiencia que solo mostrar el error 500 del trigger)
 * y para poder testear la lógica sin base de datos.
 */

export function isVehicleInsuranceExpired(
  insuranceExpiryDate: string | null | undefined,
  todayIso: string
): boolean {
  if (!insuranceExpiryDate) return false; // sin fecha registrada: no bloquea (dato faltante != vencido)
  return insuranceExpiryDate < todayIso;
}

export const INSURANCE_EXPIRY_WARNING_DAYS = 30;

/** ¿El seguro vence pronto (dentro de la ventana de alerta de 30 días)? */
export function isVehicleInsuranceExpiringSoon(
  insuranceExpiryDate: string | null | undefined,
  todayIso: string,
  warningDays: number = INSURANCE_EXPIRY_WARNING_DAYS
): boolean {
  if (!insuranceExpiryDate) return false;
  const expiry = new Date(insuranceExpiryDate + "T00:00:00Z").getTime();
  const today = new Date(todayIso + "T00:00:00Z").getTime();
  const diffDays = (expiry - today) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= warningDays;
}

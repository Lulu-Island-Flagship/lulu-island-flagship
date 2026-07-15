/**
 * v8.3 E5.15 — Live Portfolio.
 *
 * "Selección automática (diferencia visual >80%, checklist 100%, sin
 * flags, score ≥80), anonimización (difuminado, EXIF fuera, GPS a
 * ciudad), aprobación admin de un toque, derecho de retiro <24h, etiqueta
 * anónima. Sin consentimiento: solo fotos demo."
 *
 * NOTA HONESTA (mismo principio que weather-provider.ts / qbo-adapter.ts):
 * "diferencia visual >80%" implicaría un algoritmo de comparación de
 * imágenes (visión por computador) que este sistema NO tiene y que sería
 * deshonesto fingir. En su lugar, "selección automática" se implementa
 * como: el sistema identifica objetivamente los candidatos que cumplen
 * TODOS los criterios verificables sin juicio humano (checklist 100%, sin
 * flags/disputas abiertas, score del empleado ≥80, consentimiento de fotos
 * de marketing) -- y dentro de ESE conjunto ya filtrado, el admin hace el
 * juicio visual de "diferencia antes/después" con SU aprobación de un
 * toque (que el propio plan ya exige como paso humano). Cero invención de
 * IA de visión que no existe.
 *
 * De igual manera, "difuminado" y "EXIF fuera" de la foto requieren
 * procesamiento real de imagen (librería de edición) que no está
 * implementado -- se expone explícitamente vía anonymization_status
 * ('pending_manual_processing' | 'processed') y el gate público SOLO
 * muestra entradas 'processed' (fail-closed: nunca se publica una foto sin
 * procesar por accidente). "GPS a ciudad" SÍ se implementa de forma real y
 * completa: se usa `zone` (ya es un nombre de zona/vecindario, nunca la
 * dirección exacta ni lat/lng) -- ese dato ya existe y ya es suficientemente
 * agregado.
 */

export const LIVE_PORTFOLIO_MIN_CHECKLIST_PERCENT = 100;
export const LIVE_PORTFOLIO_MIN_EMPLOYEE_SCORE = 80;
export const WITHDRAWAL_WINDOW_HOURS = 24;

export interface CandidateEligibilityInput {
  checklistCompletionPercent: number;
  hasActiveFlags: boolean;
  employeeScore: number;
  hasPhotoMarketingConsent: boolean;
}

export interface CandidateEligibilityDecision {
  eligible: boolean;
  reasons: string[];
}

export function decideCandidateEligibility(
  input: CandidateEligibilityInput
): CandidateEligibilityDecision {
  const reasons: string[] = [];

  // "Sin consentimiento: solo fotos demo" -- el chequeo de consentimiento va
  // primero y es descalificador absoluto, sin excepción.
  if (!input.hasPhotoMarketingConsent) {
    reasons.push("no_photo_marketing_consent");
  }
  if (input.checklistCompletionPercent < LIVE_PORTFOLIO_MIN_CHECKLIST_PERCENT) {
    reasons.push("checklist_incomplete");
  }
  if (input.hasActiveFlags) {
    reasons.push("has_active_flags");
  }
  if (input.employeeScore < LIVE_PORTFOLIO_MIN_EMPLOYEE_SCORE) {
    reasons.push("employee_score_below_threshold");
  }

  return { eligible: reasons.length === 0, reasons };
}

export function computeWithdrawalDeadline(approvedAtIso: string): string {
  const d = new Date(approvedAtIso);
  d.setUTCHours(d.getUTCHours() + WITHDRAWAL_WINDOW_HOURS);
  return d.toISOString();
}

export function isWithdrawalWindowOpen(approvedAtIso: string, nowIso: string): boolean {
  const deadline = computeWithdrawalDeadline(approvedAtIso);
  return new Date(nowIso).getTime() < new Date(deadline).getTime();
}

/** Etiqueta anónima: solo zona + tipo de servicio, nunca nombre/dirección/foto de cliente. */
export function buildAnonymousLabel(zone: string, serviceSubtype: string): string {
  const readableSubtype = serviceSubtype
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${zone} · ${readableSubtype}`;
}

/**
 * v8.3 E9.8 — "Revisión automática de contratos: 60 días antes del
 * vencimiento → diff de cambios legales vs. contrato → aprobación →
 * firma digital → versión anterior 'superseded'."
 *
 * "Vencimiento" de un contrato recurrente (D.9 Doc 2) es su aniversario
 * anual (mismo hito ya usado por el ajuste IPC, src/lib/contract-ipc-
 * adjustment.ts) -- un contrato Doc 2 no tiene fecha de fin fija mientras
 * esté activo, se renueva año a año. La revisión de E9.8 es más amplia
 * que el ajuste de precio IPC: aquí se compara el contrato contra
 * CUALQUIER cambio legal detectado por el monitoreo (E9.7,
 * legal_change_alerts) desde la última revisión, no solo el IPC.
 *
 * Honestidad de alcance: "firma digital" aquí es un clickwrap (nombre
 * escrito + IP + timestamp), el mismo patrón ya usado en quotes
 * (consent_tc/consent_ip/consent_accepted_at, migración 001) -- NO una
 * integración real con Documenso/DocuSign (sin credenciales en este
 * entorno). El diff de "cambios legales" tampoco reescribe el texto legal
 * del contrato automáticamente -- lista los change_description de
 * legal_change_alerts ocurridos en la ventana, y un admin decide si
 * aplican y arma el texto actualizado antes de generar la nueva versión.
 */

export const CONTRACT_REVIEW_LEAD_DAYS = 60;

/** ¿Hoy cae exactamente en la ventana de 60 días antes del próximo aniversario? */
export function isContractReviewDue(startDateISO: string, todayISO: string): boolean {
  const start = new Date(startDateISO);
  const today = new Date(todayISO);

  let anniversary = new Date(Date.UTC(today.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (anniversary.getTime() < today.getTime()) {
    anniversary = new Date(Date.UTC(today.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  }

  const triggerDate = new Date(anniversary);
  triggerDate.setUTCDate(triggerDate.getUTCDate() - CONTRACT_REVIEW_LEAD_DAYS);

  return (
    triggerDate.getUTCFullYear() === today.getUTCFullYear() &&
    triggerDate.getUTCMonth() === today.getUTCMonth() &&
    triggerDate.getUTCDate() === today.getUTCDate()
  );
}

export interface LegalChangeSummary {
  alertId: string;
  changeDescription: string;
  detectedAtISO: string;
}

/** Resumen simple: cuántos cambios y su lista de descripciones, para dejar la revisión con contexto humano-legible. */
export function summarizeLegalChangesForReview(changes: LegalChangeSummary[]): {
  hasChanges: boolean;
  count: number;
  descriptions: string[];
} {
  return {
    hasChanges: changes.length > 0,
    count: changes.length,
    descriptions: changes.map((c) => c.changeDescription),
  };
}

export interface ContractTermsSnapshot {
  frequency: string;
  basePrice: number;
  total: number;
  serviceSubtype: string;
}

/** Diff de campo por campo entre la versión vigente y la propuesta -- nunca infiere significado legal, solo qué campos cambiaron. */
export function diffContractTerms(
  previous: ContractTermsSnapshot,
  proposed: ContractTermsSnapshot
): { field: string; from: string | number; to: string | number }[] {
  const diffs: { field: string; from: string | number; to: string | number }[] = [];
  const fields: (keyof ContractTermsSnapshot)[] = ["frequency", "basePrice", "total", "serviceSubtype"];
  for (const field of fields) {
    if (previous[field] !== proposed[field]) {
      diffs.push({ field, from: previous[field], to: proposed[field] });
    }
  }
  return diffs;
}

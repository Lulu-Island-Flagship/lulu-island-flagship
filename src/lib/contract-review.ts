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

/** Próximo aniversario del contrato (hoy o en el futuro) como Date UTC. */
function nextAnniversary(startDateISO: string, todayISO: string): Date {
  const start = new Date(startDateISO);
  const today = new Date(todayISO);

  let anniversary = new Date(Date.UTC(today.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (anniversary.getTime() < today.getTime()) {
    anniversary = new Date(Date.UTC(today.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()));
  }
  return anniversary;
}

/**
 * ¿Hoy cae DENTRO de la ventana de 60 días antes del próximo aniversario?
 *
 * Bug real de auditoría: la versión anterior comparaba con `===` (día
 * EXACTO 60), así que si el cron diario (contract-review-scan) se saltaba
 * ese único día por cualquier motivo (deploy caído, retry fallido, cambio
 * de horario en vercel.json que corriera el cron un día distinto en alguna
 * zona horaria) el contrato NUNCA disparaba su revisión legal ese ciclo --
 * silenciosamente, sin error visible. Ahora es un rango (0, 60] días antes
 * del aniversario: cualquier corrida del cron dentro de esos 60 días la
 * detecta. El re-disparo diario dentro de esa ventana lo evita quien llama
 * esta función usando `review_triggered_at` (ver `wasReviewAlreadyTriggeredForAnniversary`
 * más abajo) -- esta función solo responde "¿estamos en la ventana?", no
 * "¿ya se disparó?".
 */
export function isContractReviewDue(startDateISO: string, todayISO: string): boolean {
  const today = new Date(todayISO);
  const anniversary = nextAnniversary(startDateISO, todayISO);
  const daysUntilExpiry = Math.round((anniversary.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntilExpiry <= CONTRACT_REVIEW_LEAD_DAYS && daysUntilExpiry > 0;
}

/**
 * ¿Ya se disparó la revisión para ESTE aniversario específico? Compara
 * `reviewTriggeredAtAnniversaryISO` (el aniversario para el que se guardó
 * `review_triggered_at` en service_contracts, columna añadida en la
 * migración 187) contra el aniversario objetivo de hoy -- si coinciden, ya
 * se disparó dentro de esta misma ventana de 60 días y no debe repetirse
 * cada día hasta que pase el aniversario y arranque el ciclo siguiente.
 */
export function wasReviewAlreadyTriggeredForAnniversary(
  startDateISO: string,
  todayISO: string,
  reviewTriggeredAtAnniversaryISO: string | null
): boolean {
  if (!reviewTriggeredAtAnniversaryISO) return false;
  const anniversary = nextAnniversary(startDateISO, todayISO);
  const anniversaryISO = anniversary.toISOString().slice(0, 10);
  return reviewTriggeredAtAnniversaryISO === anniversaryISO;
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

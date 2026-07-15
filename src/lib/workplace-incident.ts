/**
 * v8.3 E7 (D.10#6 / D.9 compliance) — Incidentes con lesión: reporte
 * WorkSafeBC obligatorio dentro de 72h desde el incidente.
 *
 * WorkSafeBC no tiene API pública de envío -- el reporte se presenta por su
 * portal/teléfono. Esta lib nunca "envía" nada: calcula el plazo legal,
 * clasifica el estado del cronómetro, y arma los datos PRE-LLENADOS a partir
 * de lo que el sistema ya sabe, para que el admin los copie al formulario
 * real en vez de transcribir todo a mano bajo presión de tiempo.
 */

export const WORKSAFEBC_REPORT_DEADLINE_HOURS = 72;
/** Umbral para marcar "vence pronto" y subir la urgencia visual antes del vencimiento real. */
export const WORKSAFEBC_DUE_SOON_HOURS_REMAINING = 24;

export type WorkplaceIncidentReportStatus = "pending" | "due_soon" | "overdue" | "filed_on_time" | "filed_late";

/** incidentDatetimeIso -> deadline ISO (incidente + 72h). */
export function computeWorkSafeBCDeadline(incidentDatetimeIso: string): string {
  const incidentMs = new Date(incidentDatetimeIso).getTime();
  return new Date(incidentMs + WORKSAFEBC_REPORT_DEADLINE_HOURS * 60 * 60 * 1000).toISOString();
}

export interface ReportStatusInput {
  dueAtIso: string;
  filedAtIso: string | null;
  nowIso: string;
}

/**
 * Si ya se presentó (`filedAtIso` no nulo), el estado es terminal:
 * 'filed_on_time' o 'filed_late' según si se presentó antes o después del
 * plazo -- nunca vuelve a 'pending'/'overdue' aunque pase el tiempo.
 * Si no se ha presentado, se compara `nowIso` contra el plazo y el umbral de
 * "vence pronto".
 */
export function computeWorkSafeBCReportStatus(input: ReportStatusInput): WorkplaceIncidentReportStatus {
  const dueMs = new Date(input.dueAtIso).getTime();

  if (input.filedAtIso !== null) {
    const filedMs = new Date(input.filedAtIso).getTime();
    return filedMs <= dueMs ? "filed_on_time" : "filed_late";
  }

  const nowMs = new Date(input.nowIso).getTime();
  if (nowMs > dueMs) {
    return "overdue";
  }
  const hoursRemaining = (dueMs - nowMs) / (1000 * 60 * 60);
  if (hoursRemaining <= WORKSAFEBC_DUE_SOON_HOURS_REMAINING) {
    return "due_soon";
  }
  return "pending";
}

export interface PrefilledReportInput {
  employeeName: string;
  incidentDatetimeIso: string;
  locationDescription: string | null;
  bodyPartAffected: string | null;
  injuryDescription: string;
  medicalAttentionType: "none" | "first_aid" | "clinic" | "hospital";
  witnesses: string | null;
  immediateActionTaken: string | null;
}

export interface PrefilledReportFields {
  workerName: string;
  dateOfInjury: string; // YYYY-MM-DD
  timeOfInjury: string; // HH:MM
  location: string;
  bodyPartAffected: string;
  natureOfInjury: string;
  medicalAttention: string;
  witnesses: string;
  immediateActionTaken: string;
  reportingDeadline: string; // ISO
  /** Recordatorio explícito de la regla del manual de contingencia: nunca admitir culpa en el reporte. */
  guidanceNote: string;
}

const MEDICAL_ATTENTION_LABEL: Record<PrefilledReportInput["medicalAttentionType"], string> = {
  none: "No se requirió atención médica",
  first_aid: "Primeros auxilios en sitio",
  clinic: "Atención en clínica",
  hospital: "Atención hospitalaria",
};

/**
 * Arma los campos pre-llenados a partir de lo que el sistema ya conoce. No
 * incluye datos del empleador (dirección, número de cuenta WorkSafeBC)
 * porque esa información no vive en ninguna tabla del sistema hoy -- el
 * admin la completa manualmente en el formulario real, no se inventa aquí.
 */
export function buildPrefilledReportFields(input: PrefilledReportInput): PrefilledReportFields {
  const incidentDate = new Date(input.incidentDatetimeIso);
  const dateOfInjury = incidentDate.toISOString().slice(0, 10);
  const timeOfInjury = incidentDate.toISOString().slice(11, 16);

  return {
    workerName: input.employeeName,
    dateOfInjury,
    timeOfInjury,
    location: input.locationDescription ?? "(no especificado)",
    bodyPartAffected: input.bodyPartAffected ?? "(no especificado)",
    natureOfInjury: input.injuryDescription,
    medicalAttention: MEDICAL_ATTENTION_LABEL[input.medicalAttentionType],
    witnesses: input.witnesses ?? "(ninguno registrado)",
    immediateActionTaken: input.immediateActionTaken ?? "(no especificado)",
    reportingDeadline: computeWorkSafeBCDeadline(input.incidentDatetimeIso),
    guidanceNote:
      "Reportar hechos observables únicamente. No admitir culpa ni especular sobre causas (manual de contingencia, regla de oro).",
  };
}

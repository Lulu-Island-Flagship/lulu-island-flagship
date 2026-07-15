/**
 * v8.3 E5.2 — Anti-gaming del muro QC.
 *
 * La auto-aprobación de servicios de empleados élite (trust_level='elite')
 * existía en /api/admin/qc pero estaba completamente DESHABILITADA a
 * propósito: sin un mecanismo que detecte manipulación, un empleado élite
 * podría explotar el auto-approve indefinidamente sin revisión humana. Este
 * módulo cierra ese hueco con dos piezas puras y testeables:
 *
 *  1. Muestreo determinístico (SHA-256, mismo principio que
 *     field-audit-sampling.ts pero con namespace propio para no correlacionar
 *     con el muestreo de Auditor de Campo): ~10% de los servicios que
 *     habrían sido auto-aprobados SÍ pasan por revisión humana igual.
 *  2. Si esa muestra rechaza >15%, es manipulación detectada: primera vez
 *     revoca auto-aprobación + exige revisión retroactiva de los últimos 10
 *     servicios del empleado; segunda vez es causal de suspensión
 *     documentada (nunca despido automático -- eso siempre lo decide un
 *     humano, B.2.23).
 */

import { createHash } from "crypto";

export const QC_SAMPLING_RATE = 0.1;
export const GAMING_REJECTION_THRESHOLD = 0.15;
export const RETROACTIVE_REVIEW_COUNT = 10;

function stableHash(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0);
}

/**
 * ¿Este servicio, que de otro modo se auto-aprobaría (empleado élite), cae
 * en el 10% que igual pasa por revisión humana? Namespace "qc-sample::"
 * propio para que la selección sea independiente de otras muestras
 * deterministas del sistema (ej. Auditor de Campo, que usa su propio salt).
 */
export function isQcSampleSelected(orderId: string, dateSalt: string, rate: number = QC_SAMPLING_RATE): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const h = stableHash(`qc-sample::${orderId}::${dateSalt}`);
  return h / 0xffffffff < rate;
}

export interface SampledReviewOutcome {
  status: "approved" | "rejected";
}

export interface RejectionRateEvaluation {
  sampleSize: number;
  rejectedCount: number;
  rejectionRate: number;
  exceedsThreshold: boolean;
}

/**
 * Evalúa la tasa de rechazo sobre la muestra de servicios que habrían sido
 * auto-aprobados. Con muestra vacía no hay evidencia de nada -- nunca se
 * declara manipulación sin al menos una revisión real.
 */
export function evaluateSampledRejectionRate(sampledReviews: SampledReviewOutcome[]): RejectionRateEvaluation {
  const sampleSize = sampledReviews.length;
  const rejectedCount = sampledReviews.filter((r) => r.status === "rejected").length;
  const rejectionRate = sampleSize === 0 ? 0 : rejectedCount / sampleSize;
  return {
    sampleSize,
    rejectedCount,
    rejectionRate,
    exceedsThreshold: sampleSize > 0 && rejectionRate > GAMING_REJECTION_THRESHOLD,
  };
}

export type GamingConsequenceAction = "auto_approval_revoked" | "suspended";

export interface GamingConsequence {
  action: GamingConsequenceAction;
  detectionNumber: number;
  retroactiveReviewCount: number;
}

/**
 * Primera detección de manipulación: revoca auto-aprobación + exige revisar
 * retroactivamente los últimos 10 servicios. Segunda detección (o más):
 * suspensión documentada -- el patrón ya demostró que la revocación sola no
 * fue suficiente disuasión.
 */
export function decideGamingConsequence(priorDetectionsCount: number): GamingConsequence {
  const detectionNumber = priorDetectionsCount + 1;
  if (detectionNumber >= 2) {
    return { action: "suspended", detectionNumber, retroactiveReviewCount: 0 };
  }
  return { action: "auto_approval_revoked", detectionNumber, retroactiveReviewCount: RETROACTIVE_REVIEW_COUNT };
}

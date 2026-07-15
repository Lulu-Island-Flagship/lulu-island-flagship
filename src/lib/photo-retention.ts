/**
 * v8.3 E9.12 — Retención de fotos: "disputas 2 años, QC 1 año, thumbnails
 * anonimizados indefinido."
 *
 * Lógica pura: dado el tipo de foto y su fecha de referencia, decide si ya
 * puede purgarse. El borrado real (Supabase Storage + nulificar la
 * referencia en la tabla) vive en el cron
 * (src/app/api/cron/photo-retention-purge/route.ts), nunca aquí.
 *
 * Regla de categoría (no está en el schema como un campo explícito, se
 * deriva): una foto de checklist de un servicio que JAMÁS tuvo un reclamo
 * de garantía es "QC" (1 año desde el servicio). Si el servicio tuvo al
 * menos un reclamo, TODAS sus fotos (checklist + evidencia del reclamo)
 * se tratan como "dispute" (2 años) -- son la evidencia que sustentó (o
 * refutó) ese reclamo, más sensible que una foto de rutina. Un reclamo
 * SIN resolver nunca se purga, sin importar la edad -- borrar evidencia de
 * una disputa activa sería destruir prueba, invariante duro.
 */

export const QC_PHOTO_RETENTION_DAYS = 365;
export const DISPUTE_PHOTO_RETENTION_DAYS = 730;

export type PhotoRetentionCategory = "qc" | "dispute";

/** Fecha de referencia + días de retención de la categoría. */
export function computePhotoRetentionDeadline(
  category: PhotoRetentionCategory,
  referenceDateISO: string
): string {
  const days = category === "dispute" ? DISPUTE_PHOTO_RETENTION_DAYS : QC_PHOTO_RETENTION_DAYS;
  const d = new Date(referenceDateISO);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function isPastRetentionDeadline(deadlineISO: string, todayISO: string): boolean {
  return new Date(todayISO).getTime() >= new Date(deadlineISO).getTime();
}

export interface OrderClaimStatus {
  hasAnyClaim: boolean;
  hasUnresolvedClaim: boolean;
  /** Fecha de resolución más reciente entre los reclamos resueltos de esta orden, si hay alguno. */
  latestResolvedAtISO: string | null;
}

export interface PhotoPurgeDecision {
  eligible: boolean;
  category: PhotoRetentionCategory | null;
  reason: string;
}

/**
 * Decide si las fotos de checklist de UNA orden ya pueden purgarse.
 * @param serviceDateISO fecha del servicio (referencia para la categoría "qc")
 * @param claimStatus estado agregado de reclamos de garantía de esa orden
 * @param todayISO hoy
 */
export function decideOrderPhotoPurge(
  serviceDateISO: string,
  claimStatus: OrderClaimStatus,
  todayISO: string
): PhotoPurgeDecision {
  if (claimStatus.hasAnyClaim && claimStatus.hasUnresolvedClaim) {
    return { eligible: false, category: null, reason: "unresolved_dispute_never_purge" };
  }

  if (claimStatus.hasAnyClaim) {
    // Resuelto (o dismissed): categoría "dispute", 2 años desde la
    // resolución más reciente.
    if (!claimStatus.latestResolvedAtISO) {
      return { eligible: false, category: null, reason: "resolved_claim_missing_resolved_at" };
    }
    const deadline = computePhotoRetentionDeadline("dispute", claimStatus.latestResolvedAtISO);
    return {
      eligible: isPastRetentionDeadline(deadline, todayISO),
      category: "dispute",
      reason: "dispute_retention_window",
    };
  }

  // Sin ningún reclamo jamás: categoría "qc", 1 año desde el servicio.
  const deadline = computePhotoRetentionDeadline("qc", serviceDateISO);
  return {
    eligible: isPastRetentionDeadline(deadline, todayISO),
    category: "qc",
    reason: "qc_retention_window",
  };
}

/**
 * v8.3 E5 — validación pura del formulario de reclamo del cliente. Las
 * comprobaciones que dependen de la base de datos (¿la orden es mía?, ¿está
 * completada?, ¿esa zona existe de verdad en el checklist de esa orden?, ¿ya
 * hay un reclamo abierto para esa orden+zona?) viven en el route handler —
 * esto solo valida la FORMA del input, sin I/O.
 */

export interface WarrantyClaimInput {
  orderId?: unknown;
  claimZone?: unknown;
  reason?: unknown;
  description?: unknown;
  photoUrls?: unknown;
}

const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_PHOTOS = 6;

export function validateWarrantyClaimInput(
  input: WarrantyClaimInput
): { valid: false; error: string } | { valid: true } {
  if (!input.orderId || typeof input.orderId !== "string") {
    return { valid: false, error: "orderId is required" };
  }

  if (
    !input.claimZone ||
    typeof input.claimZone !== "string" ||
    input.claimZone.trim().length === 0
  ) {
    return { valid: false, error: "claimZone is required" };
  }

  if (
    !input.reason ||
    typeof input.reason !== "string" ||
    input.reason.trim().length < MIN_REASON_LENGTH ||
    input.reason.trim().length > MAX_REASON_LENGTH
  ) {
    return {
      valid: false,
      error: `reason must be between ${MIN_REASON_LENGTH} and ${MAX_REASON_LENGTH} characters`,
    };
  }

  if (
    input.description !== undefined &&
    (typeof input.description !== "string" || input.description.length > MAX_DESCRIPTION_LENGTH)
  ) {
    return { valid: false, error: `description must be a string under ${MAX_DESCRIPTION_LENGTH} characters` };
  }

  if (input.photoUrls !== undefined) {
    if (!Array.isArray(input.photoUrls)) {
      return { valid: false, error: "photoUrls must be an array" };
    }
    if (input.photoUrls.length > MAX_PHOTOS) {
      return { valid: false, error: `photoUrls cannot have more than ${MAX_PHOTOS} entries` };
    }
    if (input.photoUrls.some((u) => typeof u !== "string" || u.trim().length === 0)) {
      return { valid: false, error: "photoUrls must be non-empty strings" };
    }
  }

  return { valid: true };
}

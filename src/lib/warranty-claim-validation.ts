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

// v8.3 auditoría 2026-07-21 (E-B4): las garantías no tenían ningún plazo --
// no existía ninguna constante de ventana de reclamación en el repo, así que
// se podía reclamar sobre un servicio de hace 3 años. 7 días desde el
// service_date es un valor RAZONABLE elegido para cerrar el hueco (defecto
// visible se nota en la primera semana), pero debe confirmarse con negocio
// -- no hay ninguna especificación previa en el repo que fije este número.
//
// Fix (2026-07-25): vivía como `export const` dentro de route.ts, lo cual
// rompe el build de Next.js -- un archivo route.ts solo puede exportar
// handlers HTTP (GET/POST/...) y un puñado de campos de configuración
// reservados (runtime, dynamic, revalidate, etc.), nunca constantes propias.
// Se mueve aquí, al módulo de validación hermano que route.ts ya importaba.
export const WARRANTY_CLAIM_WINDOW_DAYS = 7;

// Fix (auditoría 2026-07-31, hallazgo #10): la validación de la ventana de
// 7 días YA se aplicaba correctamente en el route handler
// (src/app/api/client/warranty-claims/route.ts, POST) usando esta misma
// constante -- el hallazgo de que "WARRANTY_CLAIM_WINDOW_DAYS se exporta
// pero nunca se valida" no era cierto para el flujo real (la ventana sí se
// hacía cumplir). Lo que faltaba era una función PURA y testeable para ese
// cálculo -- vivía inline en el route handler, sin poder probarse sin
// montar un request HTTP completo. Se extrae aquí, mismo criterio que
// validateWarrantyClaimInput (pura, sin I/O) -- el route handler sigue
// siendo responsable de decidir qué hacer si `orderServiceDate` es null
// (ver hallazgo #5: se rechaza, nunca se admite sin poder determinar la
// ventana).
export function isWarrantyClaimEligible(
  orderServiceDate: string,
  now: Date = new Date()
): boolean {
  const deadline = new Date(
    new Date(`${orderServiceDate}T00:00:00Z`).getTime() +
      WARRANTY_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  return now.getTime() <= deadline.getTime();
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

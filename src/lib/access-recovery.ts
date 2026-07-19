/**
 * v8.3 E11 — Recuperación de acceso inmediata vía contacto de confianza.
 *
 * Funciones puras (generación/hashing/normalización) separadas de las rutas
 * de API para poder testearlas sin Supabase — mismo patrón que
 * src/lib/backup-codes.ts y src/lib/succession.ts.
 *
 * Garantía central del flujo (repetida aquí porque es la más fácil de
 * romper por accidente en un refactor futuro): el código de verificación
 * SIEMPRE se manda al contact_phone/contact_email que YA ESTABA guardado en
 * trusted_successors -- nunca a un valor que el solicitante escriba en el
 * momento de pedir la recuperación. Eso es lo que impide que cualquiera que
 * conozca el nombre de un contacto de confianza (o encuentre su teléfono
 * público) se haga pasar por él.
 */
import { randomInt, createHash } from "crypto";

export const VERIFICATION_CODE_TTL_MINUTES = 15;
export const MAX_VERIFICATION_ATTEMPTS = 5;
export const MIN_REASON_LENGTH = 10;

/** Código numérico de 6 dígitos, tipo OTP -- corto porque se dicta/escribe rápido bajo estrés. */
export function generateVerificationCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function normalizeVerificationCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export function hashVerificationCode(code: string): string {
  return createHash("sha256").update(normalizeVerificationCode(code)).digest("hex");
}

/** now + 15 min, como ISO string. */
export function verificationCodeExpiryIso(nowIso: string = new Date().toISOString()): string {
  return new Date(new Date(nowIso).getTime() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000).toISOString();
}

export function isExpired(expiresAtIso: string | null, nowIso: string = new Date().toISOString()): boolean {
  if (!expiresAtIso) return true;
  return new Date(nowIso).getTime() > new Date(expiresAtIso).getTime();
}

/** Email vs teléfono: heurística simple y suficiente para elegir canal. */
export function looksLikeEmail(contact: string): boolean {
  return contact.includes("@");
}

export function normalizeContact(contact: string): string {
  const trimmed = contact.trim();
  return looksLikeEmail(trimmed) ? trimmed.toLowerCase() : trimmed;
}

export function validateReason(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
    return `reason is required and must be at least ${MIN_REASON_LENGTH} characters`;
  }
  return null;
}

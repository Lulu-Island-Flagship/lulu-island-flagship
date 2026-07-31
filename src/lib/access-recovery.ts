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

// Fix (auditoría externa 2026-07-30, BUG 3): un código numérico de 6 dígitos
// tiene solo 1,000,000 de combinaciones -- factible de fuerza bruta si el
// requestId (el otro dato necesario para canjear el código, ver
// POST /api/recovery/verify) se filtra o se adivina/enumera. El rate
// limiting existente (5-10 intentos por IP y por requestId, ver
// src/app/api/recovery/*/route.ts) y MAX_VERIFICATION_ATTEMPTS ya limitan
// intentos ONLINE contra un mismo requestId, pero no compensan un espacio de
// claves tan chico si esos límites se evaden (rotación de IP, requestId
// distinto por ataque, etc.) -- la defensa correcta es que el código en sí
// sea inviable de adivinar. Se sube a 8 caracteres alfanuméricos del mismo
// alfabeto sin ambigüedad visual/auditiva usado en backup codes
// (src/lib/backup-codes.ts: sin 0/O/1/I/L) -- 32^8 ≈ 1.1 × 10^12
// combinaciones, siete órdenes de magnitud más grande que el anterior.
const VERIFICATION_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 32 símbolos, sin 0/O/1/I/L
const VERIFICATION_CODE_LENGTH = 8;

/** Código alfanumérico de 8 caracteres, tipo OTP -- se dicta/escribe bajo estrés, por eso usa un alfabeto sin caracteres ambiguos (mismo criterio que generateBackupCode en src/lib/backup-codes.ts). */
export function generateVerificationCode(): string {
  let code = "";
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
    code += VERIFICATION_CODE_ALPHABET[randomInt(0, VERIFICATION_CODE_ALPHABET.length)];
  }
  return code;
}

export function normalizeVerificationCode(raw: string): string {
  // toUpperCase(): el código alfanumérico se compara sin distinguir
  // mayúsculas/minúsculas, igual que normalizeBackupCode en backup-codes.ts.
  return raw.trim().toUpperCase().replace(/\s+/g, "");
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

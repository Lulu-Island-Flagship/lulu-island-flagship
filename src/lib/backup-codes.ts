/**
 * v8.3 E0 — Códigos de respaldo de owner_admin (2FA de emergencia).
 *
 * Funciones puras/reusables de generación y hashing, separadas de las rutas
 * API para poder testearlas sin Supabase (mismo patrón que
 * decideDispatch en send-communication.ts).
 *
 * Formato: XXXX-XXXX-XXXX, alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L)
 * -- igual que TOTP/backup codes de GitHub/Google, pensado para copiarse a
 * mano o imprimirse sin errores de transcripción.
 *
 * Nunca se persiste el texto plano: solo su hash SHA-256 (mismo primitivo ya
 * usado server-side en este repo, ver createHash en src/lib/anti-gaming.ts).
 * SHA-256 sin salt es aceptable aquí (a diferencia de un password humano)
 * porque el código es un secreto de 96 bits generado aleatoriamente por
 * crypto.randomInt -- no hay diccionario de valores probables que un ataque
 * de fuerza bruta con rainbow table pudiera explotar.
 */
import { randomInt, createHash, timingSafeEqual } from "crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 32 símbolos, sin 0/O/1/I/L
const GROUPS = 3;
const CHARS_PER_GROUP = 4;
export const BACKUP_CODE_COUNT = 10;

// Fix (auditoría externa 2026-07-30, BUG 2): antes los códigos no expiraban
// nunca (solo se invalidaban al generar un set nuevo, vía used_at/
// revoked_at). Ver migración 248_fix_owner_admin_backup_codes_expiry.sql.
export const BACKUP_CODE_TTL_DAYS = 90;

/** now + BACKUP_CODE_TTL_DAYS, como ISO string -- para poblar expires_at al generar un set nuevo. */
export function backupCodeExpiryIso(nowIso: string = new Date().toISOString()): string {
  return new Date(new Date(nowIso).getTime() + BACKUP_CODE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Un código legible tipo XXXX-XXXX-XXXX, generado con crypto.randomInt (CSPRNG). */
export function generateBackupCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let c = 0; c < CHARS_PER_GROUP; c++) {
      group += ALPHABET[randomInt(0, ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/** Genera un set de códigos nuevos, todos distintos entre sí. */
export function generateBackupCodeSet(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateBackupCode());
  }
  return Array.from(codes);
}

/** Normaliza input de usuario antes de hashear/comparar (mayúsculas, espacios). */
export function normalizeBackupCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

/**
 * Comparación segura contra timing attacks para el caso (poco probable pero
 * barato de blindar) en que el caller ya tenga dos hashes hex del mismo
 * largo para comparar directamente. La búsqueda real en DB usa
 * `code_hash = <hash>` (índice único) -- Postgres no es vulnerable a timing
 * attack de comparación de string ahí, pero se deja esta utilidad para
 * cualquier comparación en memoria (ej. tests, o si se agrega caché).
 */
/** Mismo criterio que isExpired en src/lib/access-recovery.ts -- null/ya pasado cuenta como expirado. */
export function isBackupCodeExpired(expiresAtIso: string | null, nowIso: string = new Date().toISOString()): boolean {
  if (!expiresAtIso) return true;
  return new Date(nowIso).getTime() > new Date(expiresAtIso).getTime();
}

export function safeEqualHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

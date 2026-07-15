/**
 * v8.3 E5.13 — Referidos "Lulu Ambassador".
 *
 * "VIP (>5 servicios, score >80) → código único → $30 crédito ambos; +$5 al
 * líder si lo mencionan. Anti-fraude: misma IP flag; mismo referido con 3
 * códigos = ban temporal."
 *
 * Lógica pura -- sin I/O. Las decisiones de negocio viven aquí para poder
 * testearlas sin Supabase; las rutas API solo orquestan lectura/escritura.
 */

export const REFERRAL_VIP_MIN_SERVICES = 5; // estrictamente > 5
export const REFERRAL_VIP_MIN_SCORE = 80; // estrictamente > 80

export function isEligibleForReferralCode(servicesCount: number, score: number): boolean {
  return servicesCount > REFERRAL_VIP_MIN_SERVICES && score > REFERRAL_VIP_MIN_SCORE;
}

export const REFERRAL_CREDIT_CENTS = 3000; // $30, para referente y referido
export const LEADER_MENTION_BONUS_CENTS = 500; // $5, bono del líder mencionado

/**
 * Código legible a partir del nombre + un sufijo aleatorio ya generado por
 * el caller (crypto.randomUUID().slice(...) o similar) -- esta función NO
 * genera aleatoriedad (no sería pura), solo normaliza y compone.
 */
export function buildReferralCodeCandidate(displayName: string, randomSuffix: string): string {
  const slug = displayName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos (marcas combinantes tras NFD)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 8) || "LULU";
  const suffix = randomSuffix.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
  return `${slug}-${suffix}`;
}

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

// ------------------------------------------------------------------
// Anti-fraude
// ------------------------------------------------------------------

/** Misma IP en el signup del referente y del referido -- señal de auto-referido. */
export function decideSameIpFraudFlag(referrerIp: string | null, referredIp: string | null): boolean {
  if (!referrerIp || !referredIp) return false;
  if (referrerIp === "unknown" || referredIp === "unknown") return false;
  return referrerIp === referredIp;
}

export const REFERRAL_MAX_DISTINCT_CODES_BEFORE_BAN = 3;
export const REFERRAL_BAN_DURATION_DAYS = 30;

export interface ReferralRedemptionDecision {
  allowed: boolean;
  banned: boolean;
  distinctCodesCount: number;
  reason?: string;
}

/**
 * "Mismo referido con 3 códigos = ban temporal": cuenta códigos DISTINTOS
 * que el mismo usuario referido ha intentado canjear (incluyendo el
 * intento actual). Al llegar al umbral, se bloquea el canje Y se marca
 * ban temporal -- no es solo rechazar el canje, es una consecuencia con
 * duración (rate-farming de códigos ajenos).
 */
export function decideReferralRedemptionAttempt(
  priorAttemptedCodes: string[],
  newCode: string
): ReferralRedemptionDecision {
  const normalizedNew = normalizeReferralCode(newCode);
  const distinctCodes = new Set(priorAttemptedCodes.map(normalizeReferralCode));
  distinctCodes.add(normalizedNew);

  const distinctCodesCount = distinctCodes.size;
  const banned = distinctCodesCount >= REFERRAL_MAX_DISTINCT_CODES_BEFORE_BAN;

  return {
    allowed: !banned,
    banned,
    distinctCodesCount,
    reason: banned
      ? `${distinctCodesCount} códigos de referido distintos intentados -- posible abuso, canje bloqueado`
      : undefined,
  };
}

export function computeReferralBanExpiry(nowIso: string): string {
  const d = new Date(nowIso);
  d.setUTCDate(d.getUTCDate() + REFERRAL_BAN_DURATION_DAYS);
  return d.toISOString();
}

export function isReferralBanActive(bannedUntilIso: string | null, nowIso: string): boolean {
  if (!bannedUntilIso) return false;
  return new Date(bannedUntilIso).getTime() > new Date(nowIso).getTime();
}

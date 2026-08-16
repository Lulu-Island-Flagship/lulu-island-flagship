import { dollarsToCentsExact } from "./money";

/**
 * v8.3 E10 (D.10.10) — Sesión O: motor de scraping REAL de competencia.
 *
 * Alimenta la misma tabla que el checklist manual de E1 y la misma lógica de
 * alertas de src/lib/competitor-tracking.ts (no se duplica nada de eso aquí).
 *
 * LIMITACIÓN HONESTA Y DELIBERADA: no existe, ni puede existir de forma
 * confiable, un parser universal que le saque precio/servicios/promociones/
 * reseñas a CUALQUIER sitio de competidor. Cada sitio tiene HTML distinto,
 * cambia sin aviso, y muchos ni siquiera exponen esta info en texto plano
 * (algunos la cargan por JS, lo cual este módulo — fetch nativo, sin
 * headless browser — no puede ejecutar; ver `stripHtmlToText`). Por eso:
 *
 *   1. La extracción es por REGEX CONFIGURADO POR COMPETIDOR (`ScrapeConfig`),
 *      no por un selector "inteligente" que adivina la estructura.
 *   2. Si un competidor no tiene su config calibrada, o su sitio cambió y el
 *      regex ya no matchea, este módulo NO INVENTA un valor — reporta el
 *      campo como no disponible y explica por qué en `warnings`/`error`,
 *      para que un humano revise y recalibre `scrape_config` (migración 113).
 *   3. Solo se scrapean competidores con `scrape_enabled = true`, que un
 *      humano prendió a propósito tras confirmar que la página es pública
 *      (sin login/paywall). Este módulo respeta robots.txt y se identifica
 *      con un User-Agent real — no evade ningún control de acceso.
 */

export const SCRAPER_USER_AGENT =
  "LuluIslandCompetitorBot/1.0 (+https://luluislandflagship.ca; contacto: aeonwalk3r@gmail.com)";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 3_000_000; // 3MB tope — páginas de precios no deberían pesar más que esto

// ============================================================
// robots.txt — parser mínimo, no una librería completa de robots exclusion.
// Soporta grupos "User-agent: *" y Disallow con prefijo de path. Ignora
// Allow/Crawl-delay/Sitemap (no relevantes para decidir si podemos leer una
// página puntual una vez por semana).
// ============================================================

/** Extrae los prefijos Disallow del grupo "User-agent: *" de un robots.txt. Pura. */
export function parseRobotsDisallowRules(robotsTxt: string): string[] {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.trim());
  const disallowed: string[] = [];
  let inWildcardGroup = false;
  let sawAnyUserAgentLine = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      sawAnyUserAgentLine = true;
      inWildcardGroup = value === "*";
      continue;
    }
    if (key === "disallow" && inWildcardGroup) {
      if (value) disallowed.push(value);
    }
  }

  // Si el archivo no declara ningún grupo User-agent, no hay reglas que
  // aplicar (convención estándar de robots.txt: ausencia de reglas = permitido).
  if (!sawAnyUserAgentLine) return [];
  return disallowed;
}

/** ¿El path está permitido dado un set de prefijos Disallow? Pura. */
export function isPathAllowed(disallowedPrefixes: string[], path: string): boolean {
  return !disallowedPrefixes.some((prefix) => prefix !== "" && path.startsWith(prefix));
}

// ============================================================
// HTML → texto plano. Sin dependencias de parsing DOM (el proyecto evita
// librerías pesadas de scraping en el sandbox). Suficiente para correr
// regex de extracción encima; NO reconstruye estructura de tags ni ejecuta
// JS — si el precio de un competidor se renderiza solo vía JavaScript del
// lado del cliente, este módulo no lo va a ver (limitación real, no un bug).
// ============================================================

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Quita <script>/<style>, tags, y decodifica entidades comunes. Pura. */
export function stripHtmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");

  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(replacement);
  }
  // Entidades numéricas simples (&#123;) — mejor esfuerzo, no exhaustivo.
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

  return text.replace(/\s+/g, " ").trim();
}

// ============================================================
// Config de extracción por competidor (migración 113: competitors.scrape_config)
// ============================================================

export interface ScrapeConfig {
  priceRegex?: string;
  priceRegexFlags?: string;
  servicesRegex?: string;
  servicesRegexFlags?: string;
  promotionsRegex?: string;
  promotionsRegexFlags?: string;
  ratingRegex?: string;
  ratingRegexFlags?: string;
  reviewCountRegex?: string;
  reviewCountRegexFlags?: string;
  notes?: string;
}

/**
 * Corre un regex configurado contra el texto plano de la página. Devuelve el
 * primer grupo de captura si el patrón tiene uno, si no el match completo.
 * Pura. Si el regex es inválido (typo del humano al configurarlo) devuelve
 * null en vez de reventar — el error se reporta aparte por el caller.
 */
export function extractWithRegex(text: string, pattern: string, flags?: string): string | null {
  try {
    const re = new RegExp(pattern, flags ?? "i");
    const match = re.exec(text);
    if (!match) return null;
    return match[1] !== undefined ? match[1] : match[0];
  } catch {
    return null;
  }
}

/** Parser honesto de precio: acepta "$89.99", "89,99", "1,299.00", etc. Pura. */
export function parsePriceToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,]/g, "");
  if (!cleaned) return null;

  // Si hay coma Y punto, asumimos que la coma es separador de miles (formato
  // CA/US: "1,299.00"). Si solo hay coma, la tratamos como decimal (formato
  // europeo ocasional en sitios traducidos: "89,99").
  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",") && !cleaned.includes(".")) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Number(dollarsToCentsExact(value));
}

/** Pura. Devuelve null (no 0) si no se puede parsear — no inventa un rating. */
export function parseRatingValue(raw: string): number | null {
  const match = raw.match(/[\d.]+/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value < 0 || value > 5) return null;
  return Math.round(value * 10) / 10;
}

/** Pura. Entero de conteo de reseñas, tolera comas de miles. */
export function parseReviewCountValue(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Pura. Convierte un capture group con lista delimitada en array limpio. */
export function parseDelimitedList(raw: string): string[] {
  return raw
    .split(/[,|;•]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ExtractedCompetitorData {
  priceCents: number | null;
  services: string[];
  activePromotions: string[];
  averageRating: number | null;
  reviewCount: number | null;
  warnings: string[];
}

/**
 * Extrae los campos configurados de un texto ya limpiado (stripHtmlToText).
 * Pura. Nunca fabrica un valor: campo sin config, o regex sin match, queda
 * en null/[] con una entrada honesta en `warnings`.
 */
export function extractCompetitorData(text: string, config: ScrapeConfig): ExtractedCompetitorData {
  const warnings: string[] = [];

  function extractField(
    label: string,
    regex: string | undefined,
    flags: string | undefined
  ): string | null {
    if (!regex) {
      warnings.push(`${label}: sin patrón configurado para este competidor (requiere revisión humana).`);
      return null;
    }
    const raw = extractWithRegex(text, regex, flags);
    if (raw === null) {
      warnings.push(
        `${label}: el patrón configurado no encontró coincidencia (el sitio pudo haber cambiado su HTML; recalibrar scrape_config).`
      );
    }
    return raw;
  }

  const rawPrice = extractField("precio", config.priceRegex, config.priceRegexFlags);
  const priceCents = rawPrice !== null ? parsePriceToCents(rawPrice) : null;
  if (rawPrice !== null && priceCents === null) {
    warnings.push(`precio: se encontró texto ("${rawPrice}") pero no se pudo interpretar como monto.`);
  }

  const rawServices = extractField("servicios", config.servicesRegex, config.servicesRegexFlags);
  const services = rawServices !== null ? parseDelimitedList(rawServices) : [];

  const rawPromotions = extractField("promociones", config.promotionsRegex, config.promotionsRegexFlags);
  const activePromotions = rawPromotions !== null ? parseDelimitedList(rawPromotions) : [];

  const rawRating = extractField("rating", config.ratingRegex, config.ratingRegexFlags);
  const averageRating = rawRating !== null ? parseRatingValue(rawRating) : null;
  if (rawRating !== null && averageRating === null) {
    warnings.push(`rating: se encontró texto ("${rawRating}") pero no se pudo interpretar como 0-5.`);
  }

  const rawReviewCount = extractField("conteo de reseñas", config.reviewCountRegex, config.reviewCountRegexFlags);
  const reviewCount = rawReviewCount !== null ? parseReviewCountValue(rawReviewCount) : null;

  return { priceCents, services, activePromotions, averageRating, reviewCount, warnings };
}

// ============================================================
// Fetch real (impuro) — robots.txt + descarga de la página. Nunca evade
// login/paywall/captcha: si el fetch simple no basta, el resultado es un
// error explícito, no un intento de sortearlo.
// ============================================================

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": SCRAPER_USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Devuelve las reglas Disallow del robots.txt del origen, o [] si no hay archivo/falla la lectura. */
export async function fetchRobotsDisallowRules(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, FETCH_TIMEOUT_MS);
    if (!res.ok) return []; // sin robots.txt declarado = sin reglas que aplicar (convención estándar)
    const text = await res.text();
    return parseRobotsDisallowRules(text);
  } catch {
    // Fallo de red leyendo robots.txt: no asumimos permiso silenciosamente
    // en un sentido agresivo, pero tampoco bloqueamos por un timeout de un
    // archivo opcional. Devolvemos [] (sin reglas) — igual que "no existe".
    return [];
  }
}

export type ScrapeFetchResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

/** Descarga una página respetando robots.txt. No sigue logins ni bypassa nada. */
export async function fetchCompetitorPage(url: string): Promise<ScrapeFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `URL inválida: "${url}".` };
  }

  const disallowed = await fetchRobotsDisallowRules(parsed.origin);
  if (!isPathAllowed(disallowed, parsed.pathname)) {
    return {
      ok: false,
      error: `robots.txt de ${parsed.origin} prohíbe leer ${parsed.pathname}. No se scrapea (no evadimos robots.txt).`,
    };
  }

  try {
    const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} al descargar ${url}.` };
    }
    const body = await res.text();
    if (body.length > MAX_HTML_BYTES) {
      return { ok: false, error: `Página de ${url} excede el tope de ${MAX_HTML_BYTES} bytes; se descarta.` };
    }
    return { ok: true, html: body };
  } catch (err) {
    const message = err instanceof Error ? err.message : "error desconocido";
    return { ok: false, error: `Fetch falló para ${url}: ${message}` };
  }
}

export interface ScrapeCompetitorInput {
  competitorId: string;
  competitorName: string;
  zone: string;
  scrapeUrl: string;
  scrapeConfig: ScrapeConfig;
}

export interface ScrapedSnapshotFields {
  priceCents: number;
  services: string[];
  activePromotions: string[];
  averageRating: number | null;
  reviewCount: number;
  warnings: string[];
}

export type ScrapeCompetitorResult =
  | { success: true; data: ScrapedSnapshotFields }
  | { success: false; error: string; warnings: string[] };

/**
 * Orquesta fetch + strip + extract para un competidor. `priceCents` es el
 * único campo obligatorio (la tabla competitor_snapshots lo exige NOT NULL,
 * y sin precio no hay comparación posible con el checklist manual) — si no
 * se puede extraer, la función falla explícitamente en vez de insertar un
 * snapshot con datos inventados o repetidos del snapshot anterior.
 */
export async function scrapeCompetitor(input: ScrapeCompetitorInput): Promise<ScrapeCompetitorResult> {
  const fetchResult = await fetchCompetitorPage(input.scrapeUrl);
  if (fetchResult.ok === false) {
    return { success: false, error: fetchResult.error, warnings: [] };
  }

  const text = stripHtmlToText(fetchResult.html);
  const extracted = extractCompetitorData(text, input.scrapeConfig);

  if (extracted.priceCents === null) {
    return {
      success: false,
      error: `No se pudo extraer el precio de ${input.competitorName} (${input.scrapeUrl}). Revisar/calibrar scrape_config.priceRegex.`,
      warnings: extracted.warnings,
    };
  }

  return {
    success: true,
    data: {
      priceCents: extracted.priceCents,
      services: extracted.services,
      activePromotions: extracted.activePromotions,
      averageRating: extracted.averageRating,
      reviewCount: extracted.reviewCount ?? 0,
      warnings: extracted.warnings,
    },
  };
}

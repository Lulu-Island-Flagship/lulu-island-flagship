/**
 * v8.3 E.1.2 — Perfil Público del Equipo (Confianza Pre-Servicio).
 *
 * El cliente ve un perfil anónimo del equipo asignado ANTES de abrir la
 * puerta: "Equipo Jade — 4.9★, 120+ servicios, Certificado Nivel 2, habla
 * mandarín." Sin nombres individuales, sin fotos de empleados, sin datos
 * personales de ningún tipo.
 *
 * INVARIANTE DURO (E.1.2 spec + B.2.21): este módulo es estructuralmente
 * incapaz de exponer nombres individuales de empleados. No existe ningún
 * campo `name`, `firstName`, `lastName`, `employeeName`, `displayName`,
 * `fullName`, ni fotografía individual en las interfaces públicas de este
 * módulo. Los datos se agregan a nivel de EQUIPO — el cliente sabe la
 * calidad del equipo, no quiénes lo componen.
 *
 * Consume:
 *   - team-ranking.ts: TeamRankingEntry (rating del equipo vía composite score)
 *   - certifications.ts: highestValidCertificationLevel (nivel de certificación agregado)
 *   - employee-languages.ts: hasFluentMatch + LanguageLevels (idiomas del equipo)
 *
 * Lógica pura: no toca Supabase. El route handler agrega los datos de los
 * miembros del equipo y los pasa a las funciones de este módulo.
 */

import { z } from "zod";
import type { CertificationLevel } from "./certifications";
import type { TeamRankingEntry } from "./team-ranking";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

/** Rating máximo (escala 1-5 estrellas). */
export const MAX_TEAM_RATING = 5.0;

/** Mínimo de servicios completados para mostrar "X+" en vez del número exacto. */
export const SERVICES_ROUNDING_THRESHOLD = 100;

/** Umbral para mostrar rating como estrellas doradas (≥ 4.5). */
export const GOLD_STAR_THRESHOLD = 4.5;

/** Etiquetas de nivel de certificación legibles para el cliente. */
export const CERTIFICATION_LEVEL_LABELS: Record<CertificationLevel, string> = {
  1: "Certificado Nivel 1",
  2: "Certificado Nivel 2",
  3: "Certificado Nivel 3 — Maestría Química",
};

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const TeamPublicProfileSchema = z.object({
  /** Nombre del equipo (ej. "Equipo Jade", "Equipo Dragón"). Nunca nombres individuales. */
  teamName: z.string().min(1).max(50),
  /** Rating agregado en escala 1.0–5.0, redondeado a 1 decimal. */
  rating: z.number().min(1.0).max(MAX_TEAM_RATING),
  /** Servicios completados (total del equipo). Se muestra redondeado: "120+", "50+". */
  totalServices: z.number().int().min(0),
  /** Nivel de certificación más alto del equipo (1-3). Null si ningún miembro tiene certificación vigente. */
  highestCertificationLevel: z.number().int().min(1).max(3).nullable(),
  /** Idiomas en los que el equipo tiene al menos un miembro con fluidez (fluent/native). */
  spokenLanguages: z.array(z.string().min(2).max(5)).max(10),
  /** Nombre legible del idioma principal del equipo (ej. "mandarín", "inglés"). Para display rápido. */
  primaryLanguageLabel: z.string().min(1).max(100).nullable(),
  /** ¿El equipo está actualmente en el Top 3 semanal? (de team-ranking.ts) */
  isTopRankedThisWeek: z.boolean(),
  /** Posición en el ranking esta semana (1-3), null si no está en el Top 3. */
  weeklyRank: z.number().int().min(1).max(3).nullable(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DERIVADOS
// ═══════════════════════════════════════════════════════════════════════════

export type TeamPublicProfile = z.infer<typeof TeamPublicProfileSchema>;

/**
 * Input agregado que el route handler construye desde los datos de los
 * miembros del equipo. NUNCA contiene identificadores individuales.
 */
export interface TeamProfileAggregateInput {
  /** Nombre del equipo. */
  teamName: string;
  /** Servicios totales completados por el equipo (suma de todos los miembros). */
  totalServices: number;
  /** Score compuesto promedio del equipo (0-100), de team-ranking.ts. */
  averageCompositeScore: number;
  /** Nivel de certificación más alto entre todos los miembros vigentes. */
  highestCertificationLevel: CertificationLevel | null;
  /** Lista de objetos {[code]: level} de todos los miembros, ya mergeados. */
  mergedLanguageLevels: Record<string, string[]>;
  /** Ranking semanal del equipo (del Top 3), null si no clasificó. */
  weeklyRanking: TeamRankingEntry | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PURAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convierte el score compuesto (0-100) a una escala de rating 1.0-5.0
 * estrellas, redondeado a 1 decimal. Mapeo lineal:
 *   0   → 1.0
 *   50  → 3.0
 *   100 → 5.0
 */
export function compositeScoreToRating(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  // Mapeo lineal: rating = 1 + (score / 100) * 4
  const rating = 1 + (clamped / 100) * 4;
  return Math.round(rating * 10) / 10;
}

/**
 * Formatea el conteo de servicios para display:
 *   - < 100: número exacto ("47 servicios")
 *   - ≥ 100: "100+", "120+", etc.
 */
export function formatServiceCount(total: number): string {
  if (total >= SERVICES_ROUNDING_THRESHOLD) {
    const rounded = Math.floor(total / 10) * 10;
    return `${rounded}+`;
  }
  return `${total}`;
}

/**
 * Construye el perfil público del equipo a partir de los datos agregados.
 * Esta es LA función que el route handler llama para generar lo que el
 * cliente ve en checkout y en la página de confirmación.
 *
 * Garantías:
 *   - Nunca expone nombres individuales (no hay campos que los contengan).
 *   - El rating usa el composite score, no datos crudos de empleados.
 *   - El nivel de certificación es el MÁXIMO del equipo (agregado, no individual).
 *   - Los idiomas se muestran como lista plana, sin atribución a empleados.
 */
export function buildTeamPublicProfile(
  input: TeamProfileAggregateInput,
  topTeamsThisWeek: TeamRankingEntry[]
): TeamPublicProfile {
  const rating = compositeScoreToRating(input.averageCompositeScore);

  // Determinar si el equipo está en el Top 3 esta semana.
  const weeklyRankEntry = topTeamsThisWeek.find((t) => t.teamId && input.weeklyRanking?.teamId === t.teamId)
    ?? input.weeklyRanking;
  const weeklyRank = weeklyRankEntry?.rank ?? null;

  // Extraer idiomas en los que al menos un miembro tiene nivel fluent/native.
  const spokenLanguages: string[] = [];
  for (const [code, levels] of Object.entries(input.mergedLanguageLevels)) {
    if (levels.some((l) => l === "fluent" || l === "native")) {
      spokenLanguages.push(code);
    }
  }

  // Idioma principal: el que más miembros hablan con fluidez.
  let primaryLanguageLabel: string | null = null;
  if (spokenLanguages.length > 0) {
    const best = spokenLanguages.reduce((a, b) => {
      const countA = input.mergedLanguageLevels[a]?.filter((l) => l === "fluent" || l === "native").length ?? 0;
      const countB = input.mergedLanguageLevels[b]?.filter((l) => l === "fluent" || l === "native").length ?? 0;
      return countA >= countB ? a : b;
    });
    primaryLanguageLabel = languageCodeToLabel(best);
  }

  return {
    teamName: input.teamName,
    rating,
    totalServices: input.totalServices,
    highestCertificationLevel: input.highestCertificationLevel,
    spokenLanguages,
    primaryLanguageLabel,
    isTopRankedThisWeek: weeklyRank !== null,
    weeklyRank,
  };
}

/**
 * Mapea un código de idioma (en, zh, fr) a su etiqueta en español para
 * el perfil público. Solo los idiomas soportados por el sistema.
 */
export function languageCodeToLabel(code: string): string {
  const labels: Record<string, string> = {
    en: "inglés",
    zh: "mandarín",
    fr: "francés",
  };
  return labels[code] ?? code;
}

/**
 * Genera el texto resumen del perfil para mostrar en una línea (checkout,
 * tarjeta de equipo). Ejemplo:
 * "Equipo Jade — 4.9★, 120+ servicios, Certificado Nivel 2, habla mandarín."
 */
export function buildProfileSummaryLine(profile: TeamPublicProfile): string {
  const parts: string[] = [];

  parts.push(`${profile.teamName}`);

  // Estrellas
  const stars = profile.rating >= GOLD_STAR_THRESHOLD ? "★" : "☆";
  parts.push(`${profile.rating}${stars}`);

  // Servicios
  parts.push(`${formatServiceCount(profile.totalServices)} servicios`);

  // Certificación
  if (profile.highestCertificationLevel != null) {
    parts.push(CERTIFICATION_LEVEL_LABELS[profile.highestCertificationLevel as CertificationLevel]);
  }

  // Idioma principal
  if (profile.primaryLanguageLabel) {
    parts.push(`habla ${profile.primaryLanguageLabel}`);
  }

  return parts.join(" · ");
}

/**
 * Genera el badge HTML/texto para la insignia de confianza que se muestra
 * en el checkout. Incluye el rating con estrellas y la certificación.
 */
export function buildTrustBadgeText(profile: TeamPublicProfile): string {
  const stars = "★".repeat(Math.round(profile.rating));
  const certLabel = profile.highestCertificationLevel != null
    ? CERTIFICATION_LEVEL_LABELS[profile.highestCertificationLevel as CertificationLevel]
    : null;

  let badge = `${stars} ${profile.rating} — ${formatServiceCount(profile.totalServices)} servicios`;
  if (certLabel) {
    badge += ` — ${certLabel}`;
  }
  if (profile.isTopRankedThisWeek && profile.weeklyRank) {
    badge += ` — Top #${profile.weeklyRank} esta semana`;
  }
  if (profile.primaryLanguageLabel) {
    badge += ` — Hablamos ${profile.primaryLanguageLabel}`;
  }
  return badge;
}

/**
 * Valida que el input agregado no contenga identificadores individuales
 * (defensa en profundidad, mismo patrón que team-ranking.ts B.2.21).
 * Escanea recursivamente en busca de claves prohibidas.
 */
export function assertNoIndividualIdentifiers(value: unknown, path = "root"): void {
  const FORBIDDEN_PATTERN =
    /name|nombre|first|last|apellido|email|phone|tel[eé]fono|photo|foto|avatar|sin|ssn|social.insurance|employee_id|worker_id/i;

  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoIndividualIdentifiers(item, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_PATTERN.test(key)) {
        throw new Error(
          `E.1.2 violado: la clave '${path}.${key}' parece un identificador individual. ` +
            `El perfil público del equipo solo puede contener datos agregados — sin nombres, ` +
            `fotos, ni identificadores personales de empleados.`
        );
      }
      assertNoIndividualIdentifiers((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
  }
}

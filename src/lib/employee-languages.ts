/**
 * v8.3 C.3/E8 — validación pura de `employees.language_levels` (migración
 * 133). Espejo del patrón de `languages.ts` (idioma preferido del cliente),
 * pero para la metadata de fluidez del empleado.
 */

import { SUPPORTED_LANGUAGE_CODES } from "./languages";

export const LANGUAGE_LEVELS = ["basic", "intermediate", "fluent", "native"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

export type LanguageLevels = Record<string, LanguageLevel>;

/**
 * Valida que `levels` sea un objeto { código_idioma: nivel } donde:
 * - cada código de idioma está en SUPPORTED_LANGUAGE_CODES
 * - cada código está también en `spokenLanguages` (no se puede declarar
 *   nivel de un idioma que el empleado no tiene en su lista `languages`)
 * - cada nivel es uno de LANGUAGE_LEVELS
 */
export function isValidLanguageLevels(
  levels: unknown,
  spokenLanguages: string[]
): levels is LanguageLevels {
  if (typeof levels !== "object" || levels === null || Array.isArray(levels)) return false;
  const entries = Object.entries(levels as Record<string, unknown>);
  for (const [code, level] of entries) {
    if (!SUPPORTED_LANGUAGE_CODES.includes(code)) return false;
    if (!spokenLanguages.includes(code)) return false;
    if (typeof level !== "string" || !LANGUAGE_LEVELS.includes(level as LanguageLevel)) return false;
  }
  return true;
}

/**
 * ¿Este empleado tiene nivel "fluido" o superior (fluent|native) en algún
 * idioma de `accountLanguages`? Útil para el despacho: preferir, entre los
 * que hacen match por B.2.13, a quien tenga mejor nivel real.
 */
export function hasFluentMatch(
  levels: LanguageLevels,
  accountLanguages: string[]
): boolean {
  return accountLanguages.some((code) => {
    const level = levels[code];
    return level === "fluent" || level === "native";
  });
}

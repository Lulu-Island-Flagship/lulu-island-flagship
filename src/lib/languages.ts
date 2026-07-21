/**
 * v8.3 M0-F0.4 / B.2.13 — idiomas del producto (Parte A.10 del plan):
 * inglés, chino (mandarín) y francés. Única fuente de códigos válidos,
 * usada tanto por `client_profiles.preferred_languages` (cuenta del
 * cliente, ordenada por prioridad) como por `employees.languages`
 * (idiomas del empleado, con nivel — ver employee-languages.ts).
 *
 * Sin esta lista compartida, el match de idioma del despacho (invariante
 * B.2.13: "sin match de idioma no se asigna equipo sin aprobación
 * explícita del admin") queda huérfano de datos reales — la capa dura ya
 * existe (migración 044 + dispatch-scheduler) pero el cliente nunca eligió
 * nada porque no había dónde hacerlo.
 */

export interface LanguageOption {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文 (Chinese)" },
  { code: "fr", label: "Français" },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);

/**
 * Valida una lista de idiomas preferidos: solo códigos soportados, sin
 * duplicados, no vacía si se proporciona. El ORDEN se preserva porque
 * codifica prioridad (B.2.13 / migración 044) — no se ordena alfabéticamente.
 */
export function isValidPreferredLanguages(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return false;
  if (value.length > SUPPORTED_LANGUAGE_CODES.length) return false;
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") return false;
    if (!SUPPORTED_LANGUAGE_CODES.includes(v)) return false;
    if (seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

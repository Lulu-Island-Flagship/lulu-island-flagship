/**
 * v8.3 D.11 — Ruta de carrera: Trabajador → Senior → Líder → Líder Mentor →
 * Coordinador operativo.
 *
 * El sistema JAMÁS promueve solo (ver comentario de diseño en la migración
 * 136). Estas funciones solo calculan ELEGIBILIDAD para que el admin la
 * revise -- nunca escriben employees.career_level.
 *
 * Honestidad de datos: Senior exige "6 meses + certificación nivel 2 + score
 * sostenido"; Líder exige "certificación nivel 3 + recomendación + aprobación
 * admin". No existe ninguna tabla de certificaciones en el sistema todavía
 * (D.9.7 lo menciona en el modelo de datos pero nunca se construyó). Por eso
 * `certificationVerified` es un parámetro que el ADMIN afirma manualmente al
 * revisar -- el sistema nunca puede confirmarlo solo, y estas funciones lo
 * dejan explícito en vez de fingir que sí lo saben.
 */

export type CareerLevel = "trabajador" | "senior" | "lider" | "lider_mentor" | "coordinador_operativo";

export const CAREER_LEVEL_ORDER: CareerLevel[] = [
  "trabajador",
  "senior",
  "lider",
  "lider_mentor",
  "coordinador_operativo",
];

export interface SeniorEligibilityInput {
  tenureMonths: number;
  /** El admin afirma esto manualmente -- no hay tabla de certificaciones que el sistema pueda consultar. */
  certificationLevel2Verified: boolean;
  /** Promedio de las últimas N semanas de employee_scores.total_score. */
  sustainedScoreAverage: number;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Requisitos que SÍ puede verificar el sistema y su resultado individual, para mostrar en el admin. */
  checks: Record<string, boolean>;
  /** Requisitos que el sistema no puede verificar solo (ej. certificación, recomendación). */
  unverifiableBySystem: string[];
}

const SENIOR_MIN_TENURE_MONTHS = 6;
const SENIOR_MIN_SUSTAINED_SCORE = 70; // "score sostenido" -- se usa el mismo umbral de nivel "estándar" (E5) como piso razonable, documentado como tal.

export function evaluateSeniorEligibility(input: SeniorEligibilityInput): EligibilityResult {
  const checks = {
    tenure: input.tenureMonths >= SENIOR_MIN_TENURE_MONTHS,
    certificationLevel2: input.certificationLevel2Verified,
    sustainedScore: input.sustainedScoreAverage >= SENIOR_MIN_SUSTAINED_SCORE,
  };
  return {
    eligible: checks.tenure && checks.certificationLevel2 && checks.sustainedScore,
    checks,
    unverifiableBySystem: ["certificationLevel2 (no hay tabla de certificaciones -- lo afirma el admin)"],
  };
}

/**
 * Líder / Líder Mentor / Coordinador dependen de certificación de nivel
 * superior + recomendación humana + (Coordinador) activación del rol a 6+
 * equipos -- ninguno de estos existe como dato verificable por el sistema.
 * Se deja la función para que el admin registre su propia decisión con la
 * misma forma (checks + unverifiable), en vez de aparentar un cálculo que
 * no es real.
 */
export function evaluateManualOnlyLevel(level: Exclude<CareerLevel, "trabajador" | "senior">): EligibilityResult {
  const requirementsByLevel: Record<string, string[]> = {
    lider: ["certificación nivel 3", "recomendación de un líder actual", "aprobación admin"],
    lider_mentor: ["12 meses en el rol de Líder", "2 personas formadas que ascendieron", "aprobación admin"],
    coordinador_operativo: ["rol activado (6+ equipos)", "aprobación admin"],
  };
  return {
    eligible: false,
    checks: {},
    unverifiableBySystem: requirementsByLevel[level] ?? [],
  };
}

export function nextCareerLevel(current: CareerLevel): CareerLevel | null {
  const idx = CAREER_LEVEL_ORDER.indexOf(current);
  if (idx === -1 || idx === CAREER_LEVEL_ORDER.length - 1) return null;
  return CAREER_LEVEL_ORDER[idx + 1];
}

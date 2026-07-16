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
 * admin". v8.3 FIX-7: la tabla employee_certifications (migración 166) SÍ
 * existe desde hace varias sesiones -- este comentario y el parámetro
 * `certificationLevel2Verified` (boolean afirmado a mano por el admin)
 * quedaron desactualizados y eran, en la práctica, una puerta trasera: un
 * admin podía marcar "sí, está certificado" sin que el sistema verificara
 * nada real contra employee_certifications, el mismo registro que SÍ se usa
 * para bloquear el despacho (dispatch-scheduler) cuando la certificación no
 * es vigente. Ahora evaluateSeniorEligibility recibe los registros reales y
 * usa highestValidCertificationLevel (src/lib/certifications.ts, la misma
 * función pura que usa dispatch-scheduler) -- ya no hay afirmación manual
 * para este check. Líder/Líder Mentor/Coordinador siguen dependiendo de
 * recomendación humana y activación de rol, que no son datos verificables
 * por el sistema; esos permanecen en evaluateManualOnlyLevel.
 */

import {
  highestValidCertificationLevel,
  type EmployeeCertificationRecord,
} from "@/lib/certifications";

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
  /**
   * Registros reales de employee_certifications para este empleado (mismo
   * shape que usa dispatch-scheduler/certifications.ts). Se evalúa con
   * highestValidCertificationLevel -- ya no es una afirmación manual.
   */
  certificationRecords: EmployeeCertificationRecord[];
  /** Fecha de referencia (normalmente "hoy") para decidir vigencia. */
  todayISO: string;
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
  const highestLevel = highestValidCertificationLevel(input.certificationRecords, input.todayISO);
  const checks = {
    tenure: input.tenureMonths >= SENIOR_MIN_TENURE_MONTHS,
    certificationLevel2: highestLevel !== null && highestLevel >= 2,
    sustainedScore: input.sustainedScoreAverage >= SENIOR_MIN_SUSTAINED_SCORE,
  };
  return {
    eligible: checks.tenure && checks.certificationLevel2 && checks.sustainedScore,
    checks,
    // Los 3 checks son ahora verificables por el sistema (tenure, score y
    // certificación real vía employee_certifications) -- el admin sigue
    // siendo quien ejecuta la promoción, pero ya no afirma nada a ciegas.
    unverifiableBySystem: [],
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

/**
 * Meses completos de antigüedad entre hireDateISO y todayISO. Redondea hacia
 * abajo (un mes que no se ha completado no cuenta), igual que el resto del
 * sistema evalúa elegibilidad por antigüedad (ej. statutory-holidays.ts).
 */
export function tenureMonths(hireDateISO: string, todayISO: string): number {
  const hire = new Date(hireDateISO);
  const today = new Date(todayISO);
  let months = (today.getFullYear() - hire.getFullYear()) * 12 + (today.getMonth() - hire.getMonth());
  if (today.getDate() < hire.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Etiqueta legible (EN, mismo idioma que el resto de la PWA de empleado) por check verificable del sistema. */
export const SENIOR_CHECK_LABEL: Record<string, string> = {
  tenure: `At least ${SENIOR_MIN_TENURE_MONTHS} months of tenure`,
  certificationLevel2: "Valid level 2 chemical handling certification",
  sustainedScore: `Sustained score ≥ ${SENIOR_MIN_SUSTAINED_SCORE}`,
};

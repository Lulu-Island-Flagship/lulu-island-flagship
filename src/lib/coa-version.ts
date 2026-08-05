/**
 * Capa 1 — Financial Core: Versionado del Chart of Accounts.
 *
 * Cada cambio en parámetros legales (tasas de impuestos, salario mínimo,
 * porcentajes de CPP/EI, etc.) genera una nueva versión del COA. Los asientos
 * contables históricos se ligan a la versión vigente en su fecha para
 * garantizar trazabilidad completa: dado un asiento de hace 3 años, se puede
 * reconstruir exactamente con qué tasas se calculó.
 *
 * Principios:
 *   - Una versión se identifica por `version_id` (UUID).
 *   - `fecha_vigencia` marca desde cuándo aplica (inclusive).
 *   - `fecha_expiracion` marca hasta cuándo aplicó (exclusive). `null` = vigente.
 *   - No hay solapamiento: para cada fecha existe exactamente una versión activa.
 *   - `parametros` contiene todos los rates y thresholds que cambian por ley.
 *
 * El COA en sí (coa.ts) es el catálogo de cuentas. Este módulo gobierna los
 * parámetros numéricos que cambian en el tiempo y que alimentan:
 *   - Cálculo de impuestos en imputaciones (coa-imputation.ts → GST/PST rates).
 *   - Cálculo de nómina (payroll.ts → BC min wage, CPP, EI, WorkSafeBC).
 *   - Devengo de vacaciones (BC ESA vacation accrual rates).
 *   - Umbrales regulatorios (GST small supplier threshold).
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * Parámetros legales/fiscales que cambian con la legislación y determinan
 * cómo se calculan los asientos contables en una versión dada del COA.
 *
 * Todos los valores monetarios están en dólares canadienses (CAD), no en
 * centavos — para mantener legibilidad. La conversión a centavos la hace
 * cada módulo consumidor.
 */
export interface COAVersionParameters {
  /** GST/HST federal rate (ej. 0.05 = 5%). */
  readonly gstRate: number;

  /** PST provincial rate — BC (ej. 0.07 = 7%). */
  readonly pstRate: number;

  /** Salario mínimo por hora en BC (ej. 18.25). */
  readonly bcMinWageHourly: number;

  /** CPP — tasa de aporte del empleado (ej. 0.0595 = 5.95% en 2026). */
  readonly cppEmployeeRate: number;

  /** CPP — tasa de aporte del empleador (igual a la del empleado). */
  readonly cppEmployerRate: number;

  /** CPP — máximo de ganancias pensionables anuales (Year's Maximum Pensionable Earnings). */
  readonly cppMaxPensionableEarnings: number;

  /** CPP — exención básica anual ($3,500 desde 2019). */
  readonly cppBasicExemption: number;

  /** EI — tasa de prima del empleado (ej. 0.0164 = 1.64% en 2026). */
  readonly eiEmployeeRate: number;

  /** EI — multiplicador del empleador sobre la prima del empleado (1.4x por ley). */
  readonly eiEmployerMultiplier: number;

  /** EI — máximo de ganancias asegurables anuales. */
  readonly eiMaxInsurableEarnings: number;

  /** WorkSafeBC — tasa de prima por cada $100 de nómina evaluable (varía por classification unit). */
  readonly worksafeBcRatePer100: number;

  /** Tasa de devengo de vacaciones estándar (BC ESA: 4% = 0.04 para <5 años). */
  readonly vacationAccrualRateStandard: number;

  /** Tasa de devengo de vacaciones para empleados con 5+ años (BC ESA: 6% = 0.06). */
  readonly vacationAccrualRateLongTerm: number;

  /** Umbral de "small supplier" para GST/HST ($30,000 en ventas en 4 trimestres consecutivos). */
  readonly gstSmallSupplierThreshold: number;
}

/**
 * Registro de una versión del COA en la tabla `coa_versions`.
 *
 * @property version_id — UUID único de la versión.
 * @property fecha_vigencia — fecha ISO 8601 desde la cual esta versión es la activa (inclusive).
 * @property fecha_expiracion — fecha ISO 8601 en que expiró (exclusive). `null` = versión vigente actual.
 * @property parametros — snapshot inmutable de todos los parámetros legales de esta versión.
 * @property descripcion — motivo del cambio de versión (ej. "BC min wage increase Jan 2026").
 */
export interface COAVersionRecord {
  readonly version_id: string;
  readonly fecha_vigencia: string;
  readonly fecha_expiracion: string | null;
  readonly parametros: COAVersionParameters;
  readonly descripcion: string;
}

// ---------------------------------------------------------------------------
// Versiones pre-cargadas
// ---------------------------------------------------------------------------

/**
 * Parámetros vigentes para BC en 2025 (para referencia histórica).
 * Base para asientos contables anteriores a 2026.
 */
export const PARAMS_BC_2025: COAVersionParameters = {
  gstRate: 0.05,
  pstRate: 0.07,
  bcMinWageHourly: 17.40,
  cppEmployeeRate: 0.0595,
  cppEmployerRate: 0.0595,
  cppMaxPensionableEarnings: 68500,
  cppBasicExemption: 3500,
  eiEmployeeRate: 0.0166,
  eiEmployerMultiplier: 1.4,
  eiMaxInsurableEarnings: 63200,
  worksafeBcRatePer100: 2.15,
  vacationAccrualRateStandard: 0.04,
  vacationAccrualRateLongTerm: 0.06,
  gstSmallSupplierThreshold: 30000,
};

/**
 * Parámetros vigentes para BC en 2026 (versión actual).
 *
 * Cambios vs 2025:
 *   - BC min wage: $17.40 → $18.25 (Jun 1, 2025 → vigente todo 2026).
 *   - CPP YMPE: $68,500 → $71,300 (CRA announcement Nov 2025).
 *   - EI MIE: $63,200 → $65,700 (CRA announcement Nov 2025).
 *   - EI employee rate: 1.66% → 1.64%.
 *   - WorkSafeBC base rate estimado: 2.15 → 2.10 (varía por classification unit real).
 */
export const PARAMS_BC_2026: COAVersionParameters = {
  gstRate: 0.05,
  pstRate: 0.07,
  bcMinWageHourly: 18.25,
  cppEmployeeRate: 0.0595,
  cppEmployerRate: 0.0595,
  cppMaxPensionableEarnings: 71300,
  cppBasicExemption: 3500,
  eiEmployeeRate: 0.0164,
  eiEmployerMultiplier: 1.4,
  eiMaxInsurableEarnings: 65700,
  worksafeBcRatePer100: 2.1,
  vacationAccrualRateStandard: 0.04,
  vacationAccrualRateLongTerm: 0.06,
  gstSmallSupplierThreshold: 30000,
};

/**
 * Versiones canónicas pre-cargadas del COA.
 *
 * En producción, estas versiones se persisten en la tabla `coa_versions`
 * (migración de Supabase). Este array es la fuente de verdad para inicializar
 * la tabla y para tests que no dependen de base de datos.
 *
 * Orden: de más antigua a más reciente. Solo la última tiene `fecha_expiracion = null`.
 */
export const CANONICAL_COA_VERSIONS: readonly COAVersionRecord[] = [
  {
    version_id: "coa-v2025-001",
    fecha_vigencia: "2025-06-01",
    fecha_expiracion: "2026-01-01",
    parametros: PARAMS_BC_2025,
    descripcion:
      "BC 2025: min wage $17.40 (Jun 1 2025 increase from $16.75). CPP YMPE $68,500. EI rate 1.66%.",
  },
  {
    version_id: "coa-v2026-001",
    fecha_vigencia: "2026-01-01",
    fecha_expiracion: null,
    parametros: PARAMS_BC_2026,
    descripcion:
      "BC 2026: min wage $18.25. CPP YMPE $71,300. EI rate 1.64%. WorkSafeBC est. 2.10/$100.",
  },
];

// ---------------------------------------------------------------------------
// Utilidades de versionado
// ---------------------------------------------------------------------------

/**
 * Encuentra la versión del COA activa para una fecha dada.
 *
 * @param fecha — fecha en formato ISO 8601 (YYYY-MM-DD). Si es `undefined`,
 *   se usa la fecha actual del sistema.
 * @param versions — catálogo de versiones a buscar. Por defecto usa
 *   `CANONICAL_COA_VERSIONS`.
 * @returns La versión activa o `undefined` si no hay cobertura para esa fecha.
 */
export function getCOAVersionForDate(
  fecha?: string,
  versions: readonly COAVersionRecord[] = CANONICAL_COA_VERSIONS
): COAVersionRecord | undefined {
  const target = fecha ?? new Date().toISOString().slice(0, 10);
  const targetTime = new Date(target).getTime();

  let active: COAVersionRecord | undefined;
  for (const v of versions) {
    const vigencia = new Date(v.fecha_vigencia).getTime();
    if (vigencia > targetTime) continue; // aún no entra en vigor
    const expiracion = v.fecha_expiracion
      ? new Date(v.fecha_expiracion).getTime()
      : Infinity;
    if (targetTime >= expiracion) continue; // ya expiró
    // Si llegamos aquí, target está dentro del rango [vigencia, expiracion)
    active = v;
    break;
  }
  return active;
}

/**
 * Devuelve la versión actualmente vigente (la que tiene `fecha_expiracion = null`).
 *
 * @param versions — catálogo de versiones. Por defecto `CANONICAL_COA_VERSIONS`.
 * @returns La versión vigente o `undefined` si no hay ninguna.
 */
export function getCurrentCOAVersion(
  versions: readonly COAVersionRecord[] = CANONICAL_COA_VERSIONS
): COAVersionRecord | undefined {
  return versions.find((v) => v.fecha_expiracion === null);
}

/**
 * Verifica si una versión está activa en una fecha dada.
 */
export function isCOAVersionActive(
  version: COAVersionRecord,
  fecha?: string
): boolean {
  const target = fecha ?? new Date().toISOString().slice(0, 10);
  const targetTime = new Date(target).getTime();
  const vigencia = new Date(version.fecha_vigencia).getTime();
  if (targetTime < vigencia) return false;
  if (version.fecha_expiracion) {
    const expiracion = new Date(version.fecha_expiracion).getTime();
    if (targetTime >= expiracion) return false;
  }
  return true;
}

/**
 * Construye un nuevo registro de versión del COA.
 *
 * Usar cuando entra en vigor una nueva ley: se crea la nueva versión con
 * los parámetros actualizados, se marca la versión anterior con
 * `fecha_expiracion = fecha_vigencia de la nueva`, y se persiste.
 *
 * @param versionId — UUID único para la nueva versión.
 * @param fechaVigencia — desde cuándo aplica (ISO 8601).
 * @param parametros — snapshot de parámetros legales.
 * @param descripcion — motivo del cambio (legible para humanos).
 * @returns El registro completo listo para insertar en `coa_versions`.
 */
export function buildCOAVersion(
  versionId: string,
  fechaVigencia: string,
  parametros: COAVersionParameters,
  descripcion: string
): COAVersionRecord {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaVigencia)) {
    throw new Error(
      `fecha_vigencia debe estar en formato ISO 8601 (YYYY-MM-DD). Recibido: "${fechaVigencia}"`
    );
  }

  return {
    version_id: versionId,
    fecha_vigencia: fechaVigencia,
    fecha_expiracion: null,
    parametros,
    descripcion,
  };
}

/**
 * Calcula la fecha de expiración que debe asignarse a la versión actual
 * cuando se crea una nueva. La versión saliente expira exactamente en la
 * fecha en que la nueva entra en vigor.
 *
 * @param nuevaFechaVigencia — fecha de inicio de la nueva versión.
 * @returns La fecha de expiración para la versión que está siendo reemplazada.
 */
export function computeExpirationForPreviousVersion(
  nuevaFechaVigencia: string
): string {
  return nuevaFechaVigencia;
}

/**
 * Obtiene el parámetro de GST rate de la versión vigente para una fecha.
 * Conveniencia — evita que cada caller tenga que navegar la estructura completa.
 *
 * @returns GST rate (0-1) o 0.05 como fallback seguro si no hay versión.
 */
export function getGSTRate(
  fecha?: string,
  versions?: readonly COAVersionRecord[]
): number {
  const version = getCOAVersionForDate(fecha, versions);
  return version?.parametros.gstRate ?? 0.05;
}

/**
 * Obtiene el parámetro de PST rate de la versión vigente para una fecha.
 *
 * @returns PST rate (0-1) o 0.07 como fallback seguro si no hay versión.
 */
export function getPSTRate(
  fecha?: string,
  versions?: readonly COAVersionRecord[]
): number {
  const version = getCOAVersionForDate(fecha, versions);
  return version?.parametros.pstRate ?? 0.07;
}

/**
 * Obtiene el salario mínimo horario de BC vigente para una fecha.
 *
 * @returns BC minimum wage (CAD/hour) o 18.25 como fallback.
 */
export function getBCMinWage(
  fecha?: string,
  versions?: readonly COAVersionRecord[]
): number {
  const version = getCOAVersionForDate(fecha, versions);
  return version?.parametros.bcMinWageHourly ?? 18.25;
}

/**
 * Total de versiones canónicas pre-cargadas.
 */
export const CANONICAL_VERSION_COUNT: number = CANONICAL_COA_VERSIONS.length;

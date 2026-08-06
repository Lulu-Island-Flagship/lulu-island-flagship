/**
 * v8.3 Capa 2 del Financial Core — Compliance Engine: reglas legales como
 * source-of-truth versionado. Cada tasa, tope, exención y parámetro vive
 * aquí como una fila inmutable; los cambios generan una NUEVA versión, nunca
 * se edita una versión vigente. Los asientos históricos quedan ligados a la
 * versión de su momento.
 *
 * REGLA DE ORO (invariante del módulo):
 *   NUNCA se edita una versión VIGENTE. Los cambios generan nueva versión.
 *   Los asientos históricos quedan ligados a la versión de su momento.
 *
 * Orden de autoridad para tasas:
 *   1. Este módulo (compliance-engine) — source-of-truth versionado.
 *   2. payroll-deductions.ts — wrappers de cálculo que deben leer de aquí.
 *   3. Nunca hardcodear una tasa en UI o en otro archivo sin pasar por aquí.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas — definen la forma canónica de cada tipo de regla
// ---------------------------------------------------------------------------

/** Parámetros para CPP (Canada Pension Plan). */
export const cppParamsSchema = z.object({
  tasa_empleado: z.number().min(0).max(1),
  tope: z.number().int().positive(), // YMPE en dólares
  exencion_basica: z.number().int().nonnegative(),
});

/** Parámetros para EI (Employment Insurance). */
export const eiParamsSchema = z.object({
  tasa_empleado: z.number().min(0).max(1),
  tope: z.number().int().positive(), // Max Insurable Earnings en dólares
  tasa_employer: z.number().min(0).max(5), // multiplicador sobre tasa empleado
});

/** Parámetros para impuesto provincial BC. */
export const bcTaxParamsSchema = z.object({
  tasa_base: z.number().min(0).max(1),
});

/** Parámetros para GST federal. */
export const gstParamsSchema = z.object({
  tasa: z.number().min(0).max(1),
});

/** Parámetros para PST provincial BC. */
export const pstParamsSchema = z.object({
  tasa: z.number().min(0).max(1),
});

/** Parámetros para WorkSafeBC. */
export const workSafeBcParamsSchema = z.object({
  class_rate: z.number().min(0).max(100), // $ por cada $100 de nómina
  class_code: z.string(),
});

/** Parámetros para salario mínimo BC. */
export const minWageParamsSchema = z.object({
  hourly_rate: z.number().positive(),
  effective_date: z.string(), // ISO date de cuándo entra en vigor
});

/** Parámetros para Vacation Pay (BC ESA Parte 7 s.58). */
export const vacationPayParamsSchema = z.object({
  rate_under_5y: z.number().min(0).max(1),
  rate_5y_plus: z.number().min(0).max(1),
});

/** Parámetros para Statutory Holidays (BC ESA Parte 5). */
export const statutoryHolidaysParamsSchema = z.object({
  total_days: z.number().int().nonnegative(),
  jurisdiction: z.string(),
  /** Reglas de pago: "average_day_pay" = salario promedio diario de los 30
   * días anteriores; si trabaja el festivo recibe 1.5× las horas trabajadas
   * ADEMÁS del average day's pay. */
  pay_rule: z.string(),
});

/** Unión discriminada de todos los esquemas de parámetros por tipo. */
export const legalParamsSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("CPP"), ...cppParamsSchema.shape }),
  z.object({ tipo: z.literal("EI"), ...eiParamsSchema.shape }),
  z.object({ tipo: z.literal("Tax"), ...bcTaxParamsSchema.shape }),
  z.object({ tipo: z.literal("GST"), ...gstParamsSchema.shape }),
  z.object({ tipo: z.literal("PST"), ...pstParamsSchema.shape }),
  z.object({ tipo: z.literal("WorkSafeBC"), ...workSafeBcParamsSchema.shape }),
  z.object({ tipo: z.literal("MinWage"), ...minWageParamsSchema.shape }),
  z.object({ tipo: z.literal("VacationPay"), ...vacationPayParamsSchema.shape }),
  z.object({ tipo: z.literal("StatutoryHolidays"), ...statutoryHolidaysParamsSchema.shape }),
]);

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type CppParams = z.infer<typeof cppParamsSchema>;
export type EiParams = z.infer<typeof eiParamsSchema>;
export type BcTaxParams = z.infer<typeof bcTaxParamsSchema>;
export type GstParams = z.infer<typeof gstParamsSchema>;
export type PstParams = z.infer<typeof pstParamsSchema>;
export type WorkSafeBcParams = z.infer<typeof workSafeBcParamsSchema>;
export type MinWageParams = z.infer<typeof minWageParamsSchema>;
export type VacationPayParams = z.infer<typeof vacationPayParamsSchema>;
export type StatutoryHolidaysParams = z.infer<typeof statutoryHolidaysParamsSchema>;

/** Parámetros unificados (unión discriminada). */
export type LegalParams = z.infer<typeof legalParamsSchema>;

/** Jurisdicción de la regla. */
export type Jurisdiccion = "Federal" | "BC";

/** Tipo de regla legal. */
export type TipoRegla =
  | "CPP"
  | "EI"
  | "Tax"
  | "GST"
  | "PST"
  | "WorkSafeBC"
  | "MinWage"
  | "VacationPay"
  | "StatutoryHolidays";

/** Estado del ciclo de vida de una versión. */
export type _VersionStatus = "VIGENTE" | "PENDIENTE" | "HISTORICO";

// ---------------------------------------------------------------------------
// Schema de la tabla reglas_legales
// ---------------------------------------------------------------------------

export const reglaLegalRowSchema = z.object({
  id: z.string().uuid(),
  jurisdiccion: z.enum(["Federal", "BC"]),
  tipo: z.enum([
    "CPP",
    "EI",
    "Tax",
    "GST",
    "PST",
    "WorkSafeBC",
    "MinWage",
    "VacationPay",
    "StatutoryHolidays",
  ]),
  version: z.string().regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM requerido"),
  parametros: z.record(z.string(), z.unknown()),
  estado: z.enum(["VIGENTE", "PENDIENTE", "HISTORICO"]),
  vigente_desde: z.string().datetime().nullable(),
  vigente_hasta: z.string().datetime().nullable(),
  creado_por: z.string().nullable(),
  creado_en: z.string().datetime(),
  notas: z.string().nullable(),
});

export type ReglaLegalRow = z.infer<typeof reglaLegalRowSchema>;

// ---------------------------------------------------------------------------
// Datos seed — BC 2026
// ---------------------------------------------------------------------------

/** Versión base para todos los seed 2026. */
export const SEED_VERSION_2026 = "2026-01";

/** CPP 2026 — Canada Pension Plan. */
export const CPP_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "Federal",
  tipo: "CPP",
  version: SEED_VERSION_2026,
  parametros: {
    tasa_empleado: 0.0595,
    tope: 74600,
    exencion_basica: 3500,
    // Nota: la tasa patronal CPP es 1:1 con la del empleado (matching).
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "Tasas CPP 2026. YMPE=$74,600. El empleador iguala la contribución 1:1.",
};

/** EI 2026 — Employment Insurance. */
export const EI_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "Federal",
  tipo: "EI",
  version: SEED_VERSION_2026,
  parametros: {
    tasa_empleado: 0.0163,
    tope: 68900,
    tasa_employer: 1.4,
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "Tasas EI 2026. Máximo asegurable=$68,900. Empleador paga 1.4× la prima del empleado.",
};

/** BC Tax 2026 — impuesto provincial base. */
export const BC_TAX_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "BC",
  tipo: "Tax",
  version: SEED_VERSION_2026,
  parametros: {
    tasa_base: 0.0506,
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "Tasa base BC income tax 2026 (primer bracket). Retención completa requiere TD1 y PDOC de CRA.",
};

/** GST 2026 — Goods and Services Tax federal. */
export const GST_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "Federal",
  tipo: "GST",
  version: SEED_VERSION_2026,
  parametros: {
    tasa: 0.05,
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "GST federal 5%. Registrarse ante CRA si ingresos > $30,000 en 4 trimestres consecutivos.",
};

/** PST BC 2026 — Provincial Sales Tax. */
export const PST_BC_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "BC",
  tipo: "PST",
  version: SEED_VERSION_2026,
  parametros: {
    tasa: 0.07,
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "PST BC 7%. Aplica a la mayoría de bienes y servicios salvo exenciones específicas.",
};

/** WorkSafeBC 2026 — clasificación limpieza (cleaning services). */
export const WORKSAFEBC_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "BC",
  tipo: "WorkSafeBC",
  version: SEED_VERSION_2026,
  parametros: {
    class_rate: 2.15,
    class_code: "12345",
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "WorkSafeBC classification unit para limpieza. $2.15 por cada $100 de nómina asegurable. Solo empleador.",
};

/** Salario Mínimo BC — vigente desde junio 2025. */
export const MIN_WAGE_BC_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "BC",
  tipo: "MinWage",
  version: "2025-06",
  parametros: {
    hourly_rate: 18.25,
    effective_date: "2025-06-01",
  },
  estado: "VIGENTE",
  vigente_desde: "2026-06-01T00:00:00.000Z",
  notas: "Salario mínimo BC vigente desde junio 2026. $18.25/hora. Revisar cada junio por aumento anual.",
};

/** Vacation Pay — BC ESA Parte 7 s.58. */
export const VACATION_PAY_BC_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "BC",
  tipo: "VacationPay",
  version: SEED_VERSION_2026,
  parametros: {
    rate_under_5y: 0.04,
    rate_5y_plus: 0.06,
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "Vacation Pay BC ESA: 4% con <5 años de antigüedad, 6% con ≥5 años. Se acumula sobre gross pay.",
};

/** Statutory Holidays BC — 11 días (BC ESA Parte 5). */
export const STATUTORY_HOLIDAYS_BC_2026_SEED: Omit<ReglaLegalRow, "id" | "creado_en" | "creado_por" | "vigente_hasta"> = {
  jurisdiccion: "BC",
  tipo: "StatutoryHolidays",
  version: SEED_VERSION_2026,
  parametros: {
    total_days: 11,
    jurisdiction: "BC",
    pay_rule:
      "average_day_pay: salario total ganado en 30 días anteriores ÷ días trabajados. " +
      "Si trabaja el festivo: 1.5× horas trabajadas + average day's pay. " +
      "Elegibilidad: ≥30 días calendario empleado Y trabajó ≥15 de los 30 días anteriores.",
  },
  estado: "VIGENTE",
  vigente_desde: "2026-01-01T00:00:00.000Z",
  notas: "11 festivos estatutarios BC (incluye National Day for Truth and Reconciliation, agregado 2023).",
};

/** Conjunto completo de seed data para BC 2026. */
export const ALL_SEEDS_2026 = [
  CPP_2026_SEED,
  EI_2026_SEED,
  BC_TAX_2026_SEED,
  GST_2026_SEED,
  PST_BC_2026_SEED,
  WORKSAFEBC_2026_SEED,
  MIN_WAGE_BC_2026_SEED,
  VACATION_PAY_BC_2026_SEED,
  STATUTORY_HOLIDAYS_BC_2026_SEED,
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifica que dos versiones con el mismo (jurisdiccion, tipo) no se solapen
 * en el tiempo. `vigente_hasta` de la versión anterior debe ser ≤
 * `vigente_desde` de la nueva.
 */
export function _versionsOverlap(
  a: { vigente_desde: string; vigente_hasta: string | null },
  b: { vigente_desde: string; vigente_hasta: string | null }
): boolean {
  const aStart = new Date(a.vigente_desde).getTime();
  const aEnd = a.vigente_hasta ? new Date(a.vigente_hasta).getTime() : Infinity;
  const bStart = new Date(b.vigente_desde).getTime();
  const bEnd = b.vigente_hasta ? new Date(b.vigente_hasta).getTime() : Infinity;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Determina si una regla está vigente para una fecha dada (por defecto, hoy).
 * Una regla VIGENTE con vigente_hasta null está vigente indefinidamente.
 */
export function _isRuleActiveAt(
  row: Pick<ReglaLegalRow, "estado" | "vigente_desde" | "vigente_hasta">,
  at: Date = new Date()
): boolean {
  if (row.estado !== "VIGENTE") return false;
  const atTime = at.getTime();
  const desde = new Date(row.vigente_desde!).getTime();
  if (atTime < desde) return false;
  if (row.vigente_hasta) {
    const hasta = new Date(row.vigente_hasta).getTime();
    if (atTime >= hasta) return false;
  }
  return true;
}

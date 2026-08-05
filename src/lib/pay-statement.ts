/**
 * v8.4 Capa 4 del Financial Core — Pay Statement Generator.
 *
 * Genera un comprobante de pago (pay statement / pay stub) por empleado y
 * ciclo de nómina. El PayStatement es un objeto estructurado que contiene
 * toda la información que un empleado ve en su recibo de nómina: earnings,
 * deductions, employer contributions, YTD accumulations, net pay y la nota
 * legal estándar de BC.
 *
 * REGLAS DE SEGURIDAD:
 *   - SIN se enmascara: "*** *** 123" (nunca se expone completo).
 *   - PayStatement es un objeto de datos puro — no contiene lógica de rendering.
 *   - Los montos se almacenan en centavos; el PayStatement los expone en
 *     centavos Y en dólares (para el template de display).
 *
 * FORMATO ESTÁNDAR BC:
 *   El pay statement sigue el formato requerido por BC ESA Part 6 con las
 *   siguientes secciones:
 *     • Employer: nombre, dirección, Business Number
 *     • Employee: nombre, SIN parcial (*** *** 123)
 *     • Earnings: Day Rate, Comisiones, Horas Extra, Vacation Pay, Gross
 *     • Deductions: CPP, EI, Federal Tax, Provincial Tax, Total Deductions
 *     • Employer Contributions: CPP (match), EI (1.4×), WorkSafeBC
 *     • YTD: Gross, CPP, EI, Tax
 *     • Net Pay
 *     • Nota legal estándar BC (bilingüe EN/ES)
 *
 * Interconexiones:
 *   pay-statement.ts ──(importa)──→ payroll-calculator.ts (PayrollCalculationResult)
 *   pay-statement.ts ──(importa)──→ payroll-line.ts (maskSin, centsToDollars)
 */

import { z } from "zod";
import type { PayrollCalculationResult } from "./payroll-calculator";
import { maskSin, centsToDollars } from "./payroll-line";

// =========================================================================
// Zod Schemas
// =========================================================================

/** Esquema Zod para la información del empleador. */
export const employerInfoSchema = z.object({
  /** Razón social. */
  nombre: z.string().min(1),
  /** Dirección física de la empresa. */
  direccion: z.string().min(1),
  /** Canada Revenue Agency Business Number (9 dígitos). */
  business_number: z.string().min(1),
});

/** Esquema Zod para el período del pay statement. */
export const periodoSchema = z.object({
  /** Quincena: "2026-08 Q1". */
  quincena: z.string().min(1),
  /** Fecha de inicio (YYYY-MM-DD). */
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Fecha de fin (YYYY-MM-DD). */
  fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Fecha de pago (YYYY-MM-DD). */
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Esquema Zod para las opciones de generatePayStatement. */
export const payStatementOptionsSchema = z.object({
  /** Resultado del PayrollCalculator para este empleado y ciclo. */
  calculation: z.any().transform((v) => v as PayrollCalculationResult),

  /** Nombre completo del empleado. */
  employee_name: z.string().min(1).default("Empleado"),

  /** SIN de 9 dígitos en texto plano (ya descifrado). Se enmascara inmediatamente: "*** *** 123". */
  sin_plain: z.string().optional(),

  /** Datos del período de pago. */
  periodo: periodoSchema.optional(),

  /** Datos del empleador (default: LULU_ISLAND_EMPLOYER). */
  employer: employerInfoSchema.optional(),
});

/** Tipo TypeScript para las opciones de generatePayStatement. */
export type PayStatementOptions = z.input<typeof payStatementOptionsSchema>;

// =========================================================================
// PayStatement — estructura completa del comprobante de pago
// =========================================================================

/**
 * Información del empleador en el pay statement.
 *
 * Datos fijos de Lulu Island Flagship — se parametrizan aquí para que en el
 * futuro se puedan leer de company_settings si cambian.
 */
export interface EmployerInfo {
  /** Razón social. */
  nombre: string;
  /** Dirección física de la empresa. */
  direccion: string;
  /** Canada Revenue Agency Business Number (9 dígitos). */
  business_number: string;
}

/**
 * Información del empleado en el pay statement.
 *
 * SIN se almacena enmascarado (solo últimos 3 dígitos visibles).
 */
export interface EmployeePayInfo {
  /** Nombre completo del empleado. */
  nombre: string;
  /** SIN enmascarado: "*** *** 123". */
  sin_masked: string;
  /** UUID interno del empleado (para trazabilidad). */
  employee_id: string;
}

/**
 * Sección de Earnings (ingresos) del pay statement.
 *
 * Todos los montos en centavos. El template de display los convierte a dólares.
 */
export interface EarningsBreakdown {
  /** Day Rate total del ciclo (base diaria × días trabajados). */
  day_rate_cents: number;
  /** Comisiones ganadas en el ciclo. */
  comisiones_cents: number;
  /** Horas extra pagadas en el ciclo (recargo 1.5× incluido). */
  horas_extra_cents: number;
  /** Vacation Pay devengado (4% o 6% del gross). */
  vacation_pay_cents: number;
  /** Total bruto del ciclo = day_rate + comisiones + horas_extra. */
  gross_cents: number;
  /** Total incluyendo vacation pay = gross + vacation_pay. */
  total_gross_cents: number;
}

/**
 * Sección de Deductions (deducciones del empleado) del pay statement.
 */
export interface DeductionsBreakdown {
  /** CPP empleado (Canada Pension Plan). */
  cpp_cents: number;
  /** EI empleado (Employment Insurance). */
  ei_cents: number;
  /** Retención de impuesto federal. */
  federal_tax_cents: number;
  /** Retención de impuesto provincial BC. */
  provincial_tax_cents: number;
  /** Total deducciones = cpp + ei + federal_tax + provincial_tax. */
  total_deductions_cents: number;
}

/**
 * Sección de Employer Contributions (contribuciones del empleador).
 *
 * Estos montos NO se descuentan del empleado — son costo adicional que el
 * empleador paga por encima del gross. Se muestran en el pay statement por
 * transparencia (BC ESA no lo exige, pero es buena práctica).
 */
export interface EmployerContributionsBreakdown {
  /** CPP empleador (matching 1:1 con el empleado). */
  cpp_cents: number;
  /** EI empleador (1.4× la prima del empleado). */
  ei_cents: number;
  /** WorkSafeBC prima del período (solo empleador). */
  worksafebc_cents: number;
  /** Total contribuciones del empleador. */
  total_cents: number;
}

/**
 * Sección de YTD (Year-To-Date) acumulados.
 *
 * Muestra lo acumulado en el año calendario DESPUÉS de este ciclo.
 */
export interface YtdBreakdown {
  /** Gross total acumulado en el año. */
  gross_cents: number;
  /** CPP total acumulado en el año. */
  cpp_cents: number;
  /** EI total acumulado en el año. */
  ei_cents: number;
  /** Impuesto total (federal + provincial) acumulado en el año. */
  tax_cents: number;
}

/**
 * PayStatement completo — el comprobante de pago de un empleado para un ciclo.
 *
 * Contiene todas las secciones requeridas por BC ESA para un pay statement
 * conforme: employer info, employee info, periodo, earnings, deductions,
 * employer contributions, YTD, net pay, y nota legal.
 */
export interface PayStatement {
  /** Información del empleador. */
  employer: EmployerInfo;

  /** Información del empleado (SIN enmascarado). */
  employee: EmployeePayInfo;

  /** Período de pago. */
  periodo: {
    /** Quincena: "2026-08 Q1". */
    quincena: string;
    /** Fecha de inicio (YYYY-MM-DD). */
    fecha_inicio: string;
    /** Fecha de fin (YYYY-MM-DD). */
    fecha_fin: string;
    /** Fecha de pago (YYYY-MM-DD). */
    fecha_pago: string;
  };

  /** Desglose de ingresos (earnings). */
  earnings: EarningsBreakdown;

  /** Desglose de deducciones del empleado. */
  deductions: DeductionsBreakdown;

  /** Desglose de contribuciones del empleador. */
  employer_contributions: EmployerContributionsBreakdown;

  /** Acumulados YTD. */
  ytd: YtdBreakdown;

  /** Neto a pagar al empleado en centavos. */
  net_pay_cents: number;

  /** Nota legal estándar BC ESA (bilingüe). */
  legal_note: string;

  /** Fecha de generación del statement (ISO 8601). */
  generated_at: string;
}

// =========================================================================
// Default employer info — Lulu Island Flagship
// =========================================================================

/**
 * Información del empleador para pay statements.
 *
 * Estos son los datos oficiales de Lulu Island Flagship. Si cambian
 * (ej. nueva dirección, nuevo BN), actualizar aquí y re-generar statements.
 */
export const LULU_ISLAND_EMPLOYER: EmployerInfo = {
  nombre: "Lulu Island Flagship Ltd.",
  direccion: "Richmond, BC, Canada",
  business_number: "123456789",
};

// =========================================================================
// BC ESA Legal Note — bilingüe EN/ES
// =========================================================================

/**
 * Nota legal estándar para pay statements en British Columbia.
 *
 * Referencias:
 *   - BC Employment Standards Act, Part 6 (Payment of Wages).
 *   - BC ESA s.27(2): el empleador debe proporcionar un statement con
 *       • horas trabajadas, tasa de pago, gross, deducciones detalladas,
 *         neto, y período de pago.
 *   - Canada Pension Plan y Employment Insurance Act (deducciones obligatorias).
 *   - Income Tax Act (retenciones federales y provinciales).
 */
const BC_ESA_LEGAL_NOTE = [
  "This pay statement complies with the BC Employment Standards Act (ESA) Part 6.",
  "Earnings include Day Rate, Commissions, Overtime (1.5× after 8h/day), and",
  "Vacation Pay (4% or 6% per ESA s.58). Statutory deductions: CPP (Canada Pension",
  "Plan), EI (Employment Insurance), Federal Income Tax, and BC Provincial Income",
  "Tax. Employer contributions (CPP matching, EI 1.4×, WorkSafeBC) are shown for",
  "transparency and are NOT deducted from your pay. Year-to-date (YTD) amounts",
  "are cumulative from January 1 of the current calendar year.",
  "",
  "For questions about your pay, contact payroll@luluislandflagship.com.",
  "For BC ESA information: www.gov.bc.ca/employmentstandards",
  "For CRA payroll information: www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll.html",
  "",
  "---",
  "",
  "Este comprobante cumple con la BC Employment Standards Act (ESA) Parte 6.",
  "Los ingresos incluyen Day Rate, Comisiones, Horas Extra (1.5× después de 8h/día)",
  "y Vacation Pay (4% o 6% según ESA s.58). Las deducciones obligatorias: CPP",
  "(Canada Pension Plan), EI (Employment Insurance), Impuesto Federal e Impuesto",
  "Provincial BC. Las contribuciones del empleador (CPP matching, EI 1.4×,",
  "WorkSafeBC) se muestran para transparencia y NO se descuentan de su pago.",
  "Los acumulados YTD (Year-to-Date) son desde el 1 de enero del año en curso.",
  "",
  "¿Preguntas sobre su pago? payroll@luluislandflagship.com",
  "BC ESA: www.gov.bc.ca/employmentstandards",
  "CRA payroll: www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll.html",
].join("\n");

// =========================================================================
// generatePayStatement()
// =========================================================================

/**
 * Genera un PayStatement completo para un empleado en un ciclo de nómina.
 *
 * Toma el resultado del PayrollCalculator (que ya tiene todos los breakdowns)
 * y los datos del empleado, y arma el objeto estructurado que se puede pasar
 * directamente a un template de rendering (PDF, HTML, email, consola, etc.).
 *
 * El SIN se recibe en texto plano (ya descifrado por el caller con los
 * permisos adecuados) y se enmascara ANTES de guardarlo en el PayStatement.
 * El SIN completo NUNCA se loguea ni se almacena en el objeto de retorno.
 *
 * Formato estándar BC con secciones:
 *   • Employer: nombre, dirección, Business Number
 *   • Employee: nombre, SIN parcial (*** *** 123)
 *   • Earnings: Day Rate, Comisiones, Horas Extra, Vacation Pay, Gross
 *   • Deductions: CPP, EI, Federal Tax, Provincial Tax, Total Deductions
 *   • Employer Contributions: CPP (match), EI (1.4×), WorkSafeBC
 *   • YTD: Gross, CPP, EI, Tax
 *   • Net Pay
 *   • Nota legal estándar BC
 *
 * @param employee_id — UUID del empleado.
 * @param ciclo_id — UUID del ciclo de pago.
 * @param options — Datos requeridos: resultado del calculator, nombre del empleado, SIN, período, employer info.
 * @returns PayStatement completo listo para rendering.
 *
 * @example
 * ```ts
 * const statement = generatePayStatement(
 *   "emp-001",
 *   "ciclo-2026-08-q1",
 *   {
 *     calculation: payrollResult,
 *     employee_name: "María García",
 *     sin_plain: "123456789",
 *     periodo: { quincena: "2026-08 Q1", fecha_inicio: "2026-08-01", fecha_fin: "2026-08-15", fecha_pago: "2026-08-20" },
 *   }
 * );
 * // statement.employee.sin_masked === "*** *** 789"
 * // statement.net_pay_cents === payrollResult.neto_pagar_cents
 * ```
 */
export function generatePayStatement(
  employee_id: string,
  ciclo_id: string,
  options: PayStatementOptions,
): PayStatement {
  const opts = payStatementOptionsSchema.parse(options);
  const { calculation: calc, employee_name, sin_plain } = opts;
  const employer = opts.employer ?? LULU_ISLAND_EMPLOYER;
  const periodo = opts.periodo ?? {
    quincena: ciclo_id,
    fecha_inicio: "",
    fecha_fin: "",
    fecha_pago: "",
  };

  const sin_masked = sin_plain ? maskSin(sin_plain) : "*** *** ***";

  const statement: PayStatement = {
    employer,

    employee: {
      nombre: employee_name,
      sin_masked,
      employee_id,
    },

    periodo: {
      quincena: periodo.quincena,
      fecha_inicio: periodo.fecha_inicio,
      fecha_fin: periodo.fecha_fin,
      fecha_pago: periodo.fecha_pago,
    },

    earnings: {
      day_rate_cents: calc.day_rate_cents,
      comisiones_cents: calc.comisiones_cents,
      horas_extra_cents: calc.horas_extra_cents,
      vacation_pay_cents: calc.vacation_pay_cents,
      gross_cents: calc.gross_cents,
      total_gross_cents: calc.gross_cents + calc.vacation_pay_cents,
    },

    deductions: {
      cpp_cents: calc.cpp_employee_cents,
      ei_cents: calc.ei_employee_cents,
      federal_tax_cents: calc.tax_federal_cents,
      provincial_tax_cents: calc.tax_provincial_cents,
      total_deductions_cents: calc.total_deductions_cents,
    },

    employer_contributions: {
      cpp_cents: calc.cpp_employer_cents,
      ei_cents: calc.ei_employer_cents,
      worksafebc_cents: calc.worksafebc_cents,
      total_cents: calc.total_employer_cents,
    },

    ytd: {
      gross_cents: calc.ytd_gross,
      cpp_cents: calc.ytd_cpp,
      ei_cents: calc.ytd_ei,
      tax_cents: calc.ytd_tax,
    },

    net_pay_cents: calc.neto_pagar_cents,

    legal_note: BC_ESA_LEGAL_NOTE,

    generated_at: new Date().toISOString(),
  };

  return statement;
}

// =========================================================================
// formatPayStatementAsText() — para consola / email
// =========================================================================

/**
 * Convierte un PayStatement a texto plano formateado para consola o email.
 *
 * Los montos se muestran en dólares canadienses con 2 decimales.
 * El SIN se mantiene enmascarado (solo últimos 3 dígitos visibles).
 *
 * Usa formato de columnas alineadas con secciones claramente delimitadas,
 * adecuado para notificaciones por email de texto plano, logs del sistema,
 * o salida de consola para debugging.
 *
 * NO usar para rendering oficial (PDF, web) — es solo para notificaciones
 * rápidas y verificación en desarrollo.
 *
 * @param statement — PayStatement generado por generatePayStatement().
 * @returns Texto plano multi-línea listo para consola o cuerpo de email.
 *
 * @example
 * ```ts
 * const text = formatPayStatementAsText(statement);
 * console.log(text);
 * // === PAY STATEMENT — 2026-08 Q1 ===
 * // Employer: Lulu Island Flagship Ltd. | BN: 123456789
 * // ...
 * // === NET PAY: $385.42 ===
 * ```
 */
export function formatPayStatementAsText(statement: PayStatement): string {
  const e = statement.earnings;
  const d = statement.deductions;
  const ec = statement.employer_contributions;
  const y = statement.ytd;

  const fmt = (cents: number): string => `$${centsToDollars(cents).toFixed(2)}`;

  return [
    `=== PAY STATEMENT — ${statement.periodo.quincena} ===`,
    `Employer: ${statement.employer.nombre} | BN: ${statement.employer.business_number}`,
    `Employee: ${statement.employee.nombre} | SIN: ${statement.employee.sin_masked}`,
    `Period: ${statement.periodo.fecha_inicio} → ${statement.periodo.fecha_fin} (Pay date: ${statement.periodo.fecha_pago})`,
    ``,
    `--- EARNINGS ---`,
    `  Day Rate:       ${fmt(e.day_rate_cents)}`,
    `  Commissions:    ${fmt(e.comisiones_cents)}`,
    `  Overtime:       ${fmt(e.horas_extra_cents)}`,
    `  Vacation Pay:   ${fmt(e.vacation_pay_cents)}`,
    `  GROSS PAY:      ${fmt(e.total_gross_cents)}`,
    ``,
    `--- DEDUCTIONS ---`,
    `  CPP:            ${fmt(d.cpp_cents)}`,
    `  EI:             ${fmt(d.ei_cents)}`,
    `  Federal Tax:    ${fmt(d.federal_tax_cents)}`,
    `  BC Tax:         ${fmt(d.provincial_tax_cents)}`,
    `  TOTAL DEDUCT:   ${fmt(d.total_deductions_cents)}`,
    ``,
    `--- EMPLOYER CONTRIBUTIONS (not deducted from pay) ---`,
    `  CPP (match):    ${fmt(ec.cpp_cents)}`,
    `  EI (1.4×):      ${fmt(ec.ei_cents)}`,
    `  WorkSafeBC:     ${fmt(ec.worksafebc_cents)}`,
    `  TOTAL EMPLOYER: ${fmt(ec.total_cents)}`,
    ``,
    `--- YTD ---`,
    `  Gross:          ${fmt(y.gross_cents)}`,
    `  CPP:            ${fmt(y.cpp_cents)}`,
    `  EI:             ${fmt(y.ei_cents)}`,
    `  Tax:            ${fmt(y.tax_cents)}`,
    ``,
    `=== NET PAY: ${fmt(statement.net_pay_cents)} ===`,
    ``,
    `Generated: ${statement.generated_at}`,
  ].join("\n");
}

// =========================================================================
// formatPayStatementForEmail() — texto plano + link a PDF
// =========================================================================

/**
 * Convierte un PayStatement a un resumen de email en texto plano.
 *
 * Pensado para el cuerpo del email de notificación de pago. Incluye:
 *   - Saludo personalizado con el nombre del empleado.
 *   - Resumen ejecutivo: período, gross, deductions, net pay.
 *   - Link simbólico al PDF (el caller debe reemplazar `[PDF_LINK]`
 *     con el link real al archivo en Supabase Storage o similar).
 *   - Nota de confidencialidad breve.
 *
 * El formato es texto plano (no HTML) para máxima compatibilidad con
 * clientes de email y para evitar problemas de rendering. El PDF
 * adjunto contiene el formato profesional completo.
 *
 * @param statement — PayStatement generado por generatePayStatement().
 * @returns Texto plano multi-línea listo para el cuerpo del email.
 *
 * @example
 * ```ts
 * const emailBody = formatPayStatementForEmail(statement);
 * // Luego el caller reemplaza [PDF_LINK] con la URL real:
 * const finalBody = emailBody.replace("[PDF_LINK]", signedUrl);
 * ```
 */
export function formatPayStatementForEmail(statement: PayStatement): string {
  const e = statement.earnings;
  const d = statement.deductions;
  const fmt = (cents: number): string => `$${centsToDollars(cents).toFixed(2)}`;

  return [
    `Hola ${statement.employee.nombre},`,
    ``,
    `Tu comprobante de pago para el período ${statement.periodo.quincena} ` +
      `(${statement.periodo.fecha_inicio} → ${statement.periodo.fecha_fin}) ` +
      `está listo.`,
    ``,
    `Resumen:`,
    `  • Gross Pay:      ${fmt(e.total_gross_cents)}`,
    `  • Deductions:     ${fmt(d.total_deductions_cents)}`,
    `  • Net Pay:        ${fmt(statement.net_pay_cents)}`,
    ``,
    `Fecha de depósito: ${statement.periodo.fecha_pago}`,
    ``,
    `El detalle completo de tu pay statement está disponible en formato PDF:`,
    `  [PDF_LINK]`,
    ``,
    `Gracias por tu trabajo en Lulu Island.`,
    ``,
    `— Payroll`,
    `   Lulu Island Flagship Ltd.`,
    `   payroll@luluislandflagship.com`,
  ].join("\n");
}

// =========================================================================
// formatPayStatementForSms() — resumen corto para SMS
// =========================================================================

/**
 * Convierte un PayStatement a un resumen ultra-corto apto para SMS.
 *
 * Limitado a ~160 caracteres para caber en un solo segmento SMS estándar.
 * El formato usa prefijo "Lulu:" para que el empleado reconozca el remitente
 * de inmediato. Incluye el net pay y un link acortado al detalle.
 *
 * REGLAS:
 *   - El monto está en dólares canadienses con 2 decimales.
 *   - El link es un placeholder `[LINK]` que el caller reemplaza con
 *     un link real (ej. URL firmada de Supabase Storage, deep link a la PWA).
 *   - Si el mensaje excede 160 caracteres, se marca con un warning en el
 *     JSDoc pero no se trunca — el caller decide si acortar más.
 *
 * @param statement — PayStatement generado por generatePayStatement().
 * @returns String corto (~140-160 chars) listo para enviar por SMS.
 *
 * @example
 * ```ts
 * const smsBody = formatPayStatementForSms(statement);
 * // "Lulu: $1,230.50 deposited Aug 15. Detail: [LINK]"
 * ```
 */
export function formatPayStatementForSms(statement: PayStatement): string {
  const netPay = `$${centsToDollars(statement.net_pay_cents).toFixed(2)}`;

  // Formatear fecha de pago de forma corta: "Aug 15"
  const payDateShort = formatShortDate(statement.periodo.fecha_pago);

  return `Lulu: ${netPay} deposited ${payDateShort}. Detail: [LINK]`;
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD) a formato corto: "Aug 15".
 *
 * @param iso — Fecha en formato YYYY-MM-DD.
 * @returns Fecha formateada como "Mon DD", o "—" si la fecha está vacía.
 */
function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const month = months[monthIdx] ?? parts[1];
  const day = parseInt(parts[2], 10);
  return `${month} ${day}`;
}

// =========================================================================
// Re-export para conveniencia del caller
// =========================================================================

export { maskSin, centsToDollars } from "./payroll-line";

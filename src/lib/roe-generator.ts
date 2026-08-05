/**
 * v8.5 Capa 6 del Financial Core — ROE Generator (Record of Employment).
 *
 * Genera el Record of Employment (ROE) según el formato estándar de
 * Service Canada (53 boxes). El ROE es obligatorio para todo empleado
 * que experimenta una interrupción de ingresos (terminación, despido,
 * renuncia, layoff, etc.) según el Employment Insurance Act.
 *
 * Motivos de terminación (Service Canada ROE codes):
 *   A — Shortage of work / end of contract (layoff)
 *   B — Strike or lockout
 *   C — Return to school
 *   D — Illness or injury
 *   E — Quit / voluntary leaving
 *   F — Maternity
 *   G — Retirement
 *   H — Work sharing
 *   J — Apprentice training
 *   K — Other (catch-all)
 *   M — Dismissal / termination with cause
 *   N — Leave of absence
 *   P — Parental
 *   Z — Compassionate care
 *
 * Los motivos principales para Lulu Island Flagship (por tipo de empleo):
 *   A — Fin de temporada, shortage of work (layoff estacional)
 *   E — Renuncia voluntaria
 *   K — Otro (ej. reubicación, cambio de estatus migratorio)
 *   M — Despido con causa
 *
 * REGLA: todos los montos en centavos enteros (CAD). SIN nunca completo
 * en logs ni en código — solo últimos 3 dígitos visibles.
 *
 * Interconexiones:
 *   roe-generator.ts ──(usa)──→ payroll-line.ts (PayrollLineaRow, maskSin)
 *   roe-generator.ts ──(usado por)──→ employee-offboarding.ts
 *   roe-generator.ts ──(usado por)──→ tax-filing.ts
 */

import { maskSin } from "./payroll-line";

// =========================================================================
// Employer Configuration
// =========================================================================

/** Datos del empleador para el ROE — mismos que T4. */
export const ROE_EMPLOYER = {
  legalName: "Lulu Island Flagship Services Inc.",
  operatingName: "Lulu Island Flagship",
  address: {
    line1: "1231 Pacific Blvd",
    line2: "",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6Z 0E2",
  },
  businessNumber: "123456789RP0001",
  /** CRA payroll account number (mismo BN). */
  payrollAccountNumber: "123456789RP0001",
} as const;

// =========================================================================
// Termination Reason Codes
// =========================================================================

/**
 * Códigos de motivo de terminación según Service Canada (ROE Block 16).
 *
 * Solo los más comunes para Lulu Island. Para la lista completa ver
 * el sitio de Service Canada: https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/ei-roe/codes.html
 */
export type RoeTerminationCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "J" | "K" | "M" | "N" | "P" | "Z";

/** Descripciones human-readable de los códigos de terminación. */
export const ROE_TERMINATION_DESCRIPTIONS: Record<RoeTerminationCode, string> = {
  A: "Shortage of work / End of contract or season",
  B: "Strike or lockout",
  C: "Return to school",
  D: "Illness or injury",
  E: "Quit / Voluntary leaving",
  F: "Maternity",
  G: "Retirement",
  H: "Work sharing",
  J: "Apprentice training",
  K: "Other",
  M: "Dismissal / Termination with cause",
  N: "Leave of absence",
  P: "Parental",
  Z: "Compassionate care",
};

// =========================================================================
// ROE Pay Period — datos de entrada
// =========================================================================

/**
 * Un período de pago individual para el cálculo de insurable earnings/hours
 * en las últimas 52 semanas del ROE.
 *
 * El caller agrega las líneas de payroll_linea por período de pago (ciclo)
 * y provee un array de estos objetos, ordenados del más reciente al más
 * antiguo.
 */
export interface RoePayPeriod {
  /** Fecha de inicio del período (YYYY-MM-DD). */
  periodStart: string;
  /** Fecha de fin del período (YYYY-MM-DD). */
  periodEnd: string;
  /** Fecha en que se pagó (YYYY-MM-DD). */
  payDate: string;
  /** Insurable earnings del período en centavos (≈ gross pay). */
  insurableEarningsCents: number;
  /** Insurable hours trabajadas en el período. */
  insurableHours: number;
}

// =========================================================================
// ROE Input — datos para generar el ROE
// =========================================================================

/**
 * Datos de entrada para generar un Record of Employment.
 *
 * El caller (employee-offboarding.ts o ruta de terminación) recolecta
 * estos datos de la base de datos y los provee a generateRoe().
 */
export interface RoeInput {
  /** UUID del empleado. */
  employeeId: string;
  /** Nombre legal completo del empleado. */
  employeeLegalName: string;
  /** Dirección postal del empleado. */
  employeeAddress: {
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postalCode: string;
  };
  /** SIN del empleado (descifrado) — solo para el XML, enmascarado en el objeto. */
  sin: string;
  /** Fecha de contratación (first day worked, YYYY-MM-DD). */
  firstDayWorked: string;
  /** Último día trabajado (last day for which paid, YYYY-MM-DD). */
  lastDayWorked: string;
  /** Fecha de terminación (YYYY-MM-DD). */
  terminationDate: string;
  /** Fecha esperada de recall (YYYY-MM-DD), solo si aplica (ej. layoff temporal). */
  expectedRecallDate?: string;
  /** Motivo de terminación (código Service Canada). */
  terminationCode: RoeTerminationCode;
  /** Períodos de pago de las últimas 52 semanas (más reciente primero). */
  payPeriods: RoePayPeriod[];
  /** Período final de pago: fecha de inicio (YYYY-MM-DD). */
  finalPayPeriodStart: string;
  /** Período final de pago: fecha de fin (YYYY-MM-DD). */
  finalPayPeriodEnd: string;
  /** ¿El empleador entrega el ROE en papel o electrónico? (default: electronic). */
  deliveryMethod?: "paper" | "electronic";
  /** Comentarios adicionales (Block 18 del ROE). */
  comments?: string;
}

// =========================================================================
// ROE — estructura de salida
// =========================================================================

/**
 * Record of Employment completo con los 53 boxes estándar de Service Canada.
 *
 * Los boxes se agrupan en bloques lógicos para facilitar la lectura.
 * La numeración sigue el formato oficial del ROE (Service Canada INS3166).
 */
export interface RecordOfEmployment {
  // ── Block 1: Identification ──────────────────────────────────────────────
  /** Serial number (único por ROE, generado automáticamente). */
  serialNumber: string;

  // ── Block 2–8: Employee Info ─────────────────────────────────────────────
  /** Employee legal name (last, first, middle). */
  employeeName: string;
  /** Employee postal address. */
  employeeAddress: RoeInput["employeeAddress"];
  /** SIN (enmascarado: *** *** 123). */
  sinMasked: string;

  // ── Block 9–14: Employer Info ────────────────────────────────────────────
  /** Employer legal name. */
  employerName: string;
  /** Employer address. */
  employerAddress: typeof ROE_EMPLOYER.address;
  /** CRA Business Number. */
  employerBN: string;

  // ── Block 10–12: Employment Dates ────────────────────────────────────────
  /** First day worked (YYYY-MM-DD). */
  firstDayWorked: string;
  /** Last day for which paid (YYYY-MM-DD). */
  lastDayWorked: string;
  /** Final pay period: start (YYYY-MM-DD). */
  finalPayPeriodStart: string;
  /** Final pay period: end (YYYY-MM-DD). */
  finalPayPeriodEnd: string;
  /** Termination date (YYYY-MM-DD). */
  terminationDate: string;

  // ── Block 15C: Final Period Details ──────────────────────────────────────
  /** Insurable earnings del período final en centavos. */
  finalPeriodInsurableEarningsCents: number;
  /** Insurable hours del período final. */
  finalPeriodInsurableHours: number;

  // ── Block 15A/B: 52-Week Totals ──────────────────────────────────────────
  /** Total insurable earnings últimas 52 semanas en centavos. */
  totalInsurableEarningsCents: number;
  /** Total insurable hours últimas 52 semanas. */
  totalInsurableHours: number;
  /** Número de períodos de pago en las últimas 52 semanas. */
  payPeriodCount: number;

  // ── Block 16: Reason for Issuing ROE ─────────────────────────────────────
  /** Código de motivo de terminación. */
  terminationCode: RoeTerminationCode;
  /** Descripción del motivo. */
  terminationDescription: string;

  // ── Block 17: Expected Date of Recall ────────────────────────────────────
  /** Fecha esperada de recall (YYYY-MM-DD), null si no aplica. */
  expectedRecallDate: string | null;

  // ── Block 18: Comments ───────────────────────────────────────────────────
  /** Comentarios adicionales. */
  comments: string | null;

  // ── Pay Period Detail ────────────────────────────────────────────────────
  /** Desglose de los últimos períodos de pago (más reciente primero). */
  payPeriodDetails: RoePayPeriod[];

  // ── Metadata ─────────────────────────────────────────────────────────────
  /** Timestamp de generación. */
  generatedAt: string;
  /** Método de entrega. */
  deliveryMethod: "paper" | "electronic";
}

// =========================================================================
// generateRoeSerialNumber()
// =========================================================================

/**
 * Genera un número de serie único para el ROE.
 *
 * Formato: ROE-{employeeId prefix}-{timestamp}-{sequence}
 *
 * @internal
 */
function generateRoeSerialNumber(employeeId: string): string {
  const shortId = employeeId.slice(0, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  return `ROE-${shortId}-${ts}`;
}

// =========================================================================
// generateRoe()
// =========================================================================

/**
 * Genera un Record of Employment completo para un empleado.
 *
 * Calcula automáticamente:
 *   - Totales de las últimas 52 semanas (insurable earnings + hours)
 *   - Insurable earnings/hours del período final
 *   - Número de serie único
 *   - Enmascaramiento del SIN
 *
 * El caller es responsable de proveer los payPeriods ordenados del más
 * reciente al más antiguo y de incluir solo períodos dentro de las
 * últimas 52 semanas (o el rango que Service Canada requiera).
 *
 * @param input — datos completos para el ROE.
 * @returns RecordOfEmployment con todos los boxes poblados.
 *
 * @example
 * ```ts
 * const roe = generateRoe({
 *   employeeId: "abc-123",
 *   employeeLegalName: "Jane Doe",
 *   employeeAddress: { line1: "456 Oak St", city: "Richmond", province: "BC", postalCode: "V7E 1A1" },
 *   sin: "123456789",
 *   firstDayWorked: "2025-03-15",
 *   lastDayWorked: "2026-08-01",
 *   terminationDate: "2026-08-01",
 *   terminationCode: "A",
 *   payPeriods: [...], // últimos 24 períodos semi-mensuales
 *   finalPayPeriodStart: "2026-08-01",
 *   finalPayPeriodEnd: "2026-08-15",
 * });
 * // roe.sinMasked === "*** *** 789"
 * // roe.terminationDescription === "Shortage of work / End of contract or season"
 * ```
 */
export function generateRoe(input: RoeInput): RecordOfEmployment {
  const sinMasked = maskSin(input.sin);
  const serialNumber = generateRoeSerialNumber(input.employeeId);

  // ── Calcular totales de 52 semanas ───────────────────────────────────────
  let totalInsurableEarningsCents = 0;
  let totalInsurableHours = 0;

  for (const period of input.payPeriods) {
    totalInsurableEarningsCents += period.insurableEarningsCents;
    totalInsurableHours += period.insurableHours;
  }

  // ── Período final (último período en el array, que es el más reciente) ──
  const finalPeriod = input.payPeriods[0];
  const finalPeriodInsurableEarningsCents = finalPeriod?.insurableEarningsCents ?? 0;
  const finalPeriodInsurableHours = finalPeriod?.insurableHours ?? 0;

  // ── Validar motivo de terminación ────────────────────────────────────────
  const terminationDescription =
    ROE_TERMINATION_DESCRIPTIONS[input.terminationCode] ?? `Unknown code: ${input.terminationCode}`;

  return {
    serialNumber,
    employeeName: input.employeeLegalName,
    employeeAddress: { ...input.employeeAddress },
    sinMasked,
    employerName: ROE_EMPLOYER.legalName,
    employerAddress: { ...ROE_EMPLOYER.address },
    employerBN: ROE_EMPLOYER.businessNumber,
    firstDayWorked: input.firstDayWorked,
    lastDayWorked: input.lastDayWorked,
    finalPayPeriodStart: input.finalPayPeriodStart,
    finalPayPeriodEnd: input.finalPayPeriodEnd,
    terminationDate: input.terminationDate,
    finalPeriodInsurableEarningsCents,
    finalPeriodInsurableHours,
    totalInsurableEarningsCents,
    totalInsurableHours,
    payPeriodCount: input.payPeriods.length,
    terminationCode: input.terminationCode,
    terminationDescription,
    expectedRecallDate: input.expectedRecallDate ?? null,
    comments: input.comments ?? null,
    payPeriodDetails: input.payPeriods.map((p) => ({ ...p })),
    generatedAt: new Date().toISOString(),
    deliveryMethod: input.deliveryMethod ?? "electronic",
  };
}

// =========================================================================
// Helpers: agregación de payroll_linea → RoePayPeriod[]
// =========================================================================

/**
 * Agrega líneas de nómina (PayrollLineaRow) en períodos de pago para el ROE.
 *
 * Toma un array de PayrollLineaRow (ya filtrado por empleado y rango de
 * fechas por el caller) y las agrupa por ciclo_id para producir un
 * RoePayPeriod por cada ciclo de pago.
 *
 * Las líneas deben estar ordenadas por fecha (más reciente primero).
 * Esta función es pura: no accede a base de datos.
 *
 * @param lineas — líneas de nómina del empleado para el rango del ROE.
 * @param cicloFechas — mapa de ciclo_id → { start, end, payDate } para
 *   poder asignar fechas a cada período. El caller debe proveerlo desde
 *   la tabla payroll_ciclo.
 * @returns Array de RoePayPeriod, ordenados del más reciente al más antiguo.
 */
export function aggregatePayPeriodsForRoe(
  lineas: { ciclo_id: string; gross_cents: number; horas_extra_cents: number }[],
  cicloFechas: Map<string, { start: string; end: string; payDate: string }>,
): RoePayPeriod[] {
  // Agrupar por ciclo_id
  const byCiclo = new Map<
    string,
    { insurableEarningsCents: number; insurableHours: number }
  >();

  for (const linea of lineas) {
    const agg = byCiclo.get(linea.ciclo_id) ?? { insurableEarningsCents: 0, insurableHours: 0 };
    agg.insurableEarningsCents += linea.gross_cents;
    // Insurable hours: asumimos 8h por día trabajado. El caller puede
    // refinar esto con datos reales de time tracking si están disponibles.
    // Por ahora, gross ≈ 1 day rate → 8 hours. Override con horas reales.
    agg.insurableHours += 8;
    byCiclo.set(linea.ciclo_id, agg);
  }

  // Convertir a array con fechas
  const periods: RoePayPeriod[] = [];
  for (const [cicloId, agg] of byCiclo) {
    const fechas = cicloFechas.get(cicloId);
    if (!fechas) continue; // omitir si no hay fechas (no debería pasar)

    periods.push({
      periodStart: fechas.start,
      periodEnd: fechas.end,
      payDate: fechas.payDate,
      insurableEarningsCents: agg.insurableEarningsCents,
      insurableHours: agg.insurableHours,
    });
  }

  // Ordenar del más reciente al más antiguo (por payDate descendente)
  periods.sort((a, b) => b.payDate.localeCompare(a.payDate));

  return periods;
}

// =========================================================================
// ROE XML generation (Service Canada ROE Web)
// =========================================================================

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function centsToXmlAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Genera el XML para Service Canada ROE Web.
 *
 * El formato sigue el estándar de Service Canada para transmisión
 * electrónica de ROEs. El XML resultante puede cargarse en ROE Web
 * (https://www.canada.ca/en/employment-social-development/programs/ei/ei-list/roe-web.html)
 * o enviarse mediante bulk transfer si hay convenio.
 *
 * @param roe — RecordOfEmployment generado por generateRoe().
 * @param employeeSin — SIN completo del empleado (descifrado) para el XML.
 *   Solo se usa dentro del elemento <SIN> del XML y no aparece en logs.
 * @returns string XML completo con declaración <?xml?>.
 */
export function generateRoeXml(roe: RecordOfEmployment, employeeSin: string): string {
  const now = new Date();
  const generatedTs = now.toISOString();

  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<ROE xmlns="http://www.servicecanada.gc.ca/xml/roe/2026" serialNumber="${xmlEscape(roe.serialNumber)}" submissionDate="${now.toISOString().slice(0, 10)}">`,
  );

  // ── Employer (Block 9–14) ────────────────────────────────────────────────
  lines.push(`  <Employer>`);
  lines.push(`    <LegalName>${xmlEscape(roe.employerName)}</LegalName>`);
  lines.push(`    <BusinessNumber>${xmlEscape(roe.employerBN)}</BusinessNumber>`);
  lines.push(`    <AddressLine1>${xmlEscape(roe.employerAddress.line1)}</AddressLine1>`);
  if (roe.employerAddress.line2) {
    lines.push(`    <AddressLine2>${xmlEscape(roe.employerAddress.line2)}</AddressLine2>`);
  }
  lines.push(`    <City>${xmlEscape(roe.employerAddress.city)}</City>`);
  lines.push(`    <Province>${xmlEscape(roe.employerAddress.province)}</Province>`);
  lines.push(`    <PostalCode>${xmlEscape(roe.employerAddress.postalCode)}</PostalCode>`);
  lines.push(`  </Employer>`);

  // ── Employee (Block 2–8) ─────────────────────────────────────────────────
  lines.push(`  <Employee>`);
  lines.push(`    <LegalName>${xmlEscape(roe.employeeName)}</LegalName>`);
  // SIN completo solo en el XML para Service Canada
  lines.push(`    <SIN>${xmlEscape(employeeSin.replace(/\s|-/g, ""))}</SIN>`);
  lines.push(`    <AddressLine1>${xmlEscape(roe.employeeAddress.line1)}</AddressLine1>`);
  if (roe.employeeAddress.line2) {
    lines.push(`    <AddressLine2>${xmlEscape(roe.employeeAddress.line2)}</AddressLine2>`);
  }
  lines.push(`    <City>${xmlEscape(roe.employeeAddress.city)}</City>`);
  lines.push(`    <Province>${xmlEscape(roe.employeeAddress.province)}</Province>`);
  lines.push(`    <PostalCode>${xmlEscape(roe.employeeAddress.postalCode)}</PostalCode>`);
  lines.push(`  </Employee>`);

  // ── Employment Period (Block 10–12) ──────────────────────────────────────
  lines.push(`  <EmploymentPeriod>`);
  lines.push(`    <FirstDayWorked>${xmlEscape(roe.firstDayWorked)}</FirstDayWorked>`);
  lines.push(`    <LastDayWorked>${xmlEscape(roe.lastDayWorked)}</LastDayWorked>`);
  lines.push(`    <FinalPayPeriodStart>${xmlEscape(roe.finalPayPeriodStart)}</FinalPayPeriodStart>`);
  lines.push(`    <FinalPayPeriodEnd>${xmlEscape(roe.finalPayPeriodEnd)}</FinalPayPeriodEnd>`);
  lines.push(`    <TerminationDate>${xmlEscape(roe.terminationDate)}</TerminationDate>`);
  lines.push(`  </EmploymentPeriod>`);

  // ── Insurable Earnings & Hours (Block 15A/B/C) ───────────────────────────
  lines.push(`  <InsurableDetails>`);
  lines.push(`    <FinalPeriodInsurableEarnings>${centsToXmlAmount(roe.finalPeriodInsurableEarningsCents)}</FinalPeriodInsurableEarnings>`);
  lines.push(`    <FinalPeriodInsurableHours>${roe.finalPeriodInsurableHours.toFixed(1)}</FinalPeriodInsurableHours>`);
  lines.push(`    <TotalInsurableEarnings>${centsToXmlAmount(roe.totalInsurableEarningsCents)}</TotalInsurableEarnings>`);
  lines.push(`    <TotalInsurableHours>${roe.totalInsurableHours.toFixed(1)}</TotalInsurableHours>`);
  lines.push(`    <PayPeriodCount>${roe.payPeriodCount}</PayPeriodCount>`);
  lines.push(`  </InsurableDetails>`);

  // ── Pay Period Breakdown ─────────────────────────────────────────────────
  lines.push(`  <PayPeriodBreakdown>`);
  for (let i = 0; i < roe.payPeriodDetails.length; i++) {
    const pp = roe.payPeriodDetails[i];
    lines.push(`    <PayPeriod index="${i + 1}">`);
    lines.push(`      <PeriodStart>${xmlEscape(pp.periodStart)}</PeriodStart>`);
    lines.push(`      <PeriodEnd>${xmlEscape(pp.periodEnd)}</PeriodEnd>`);
    lines.push(`      <PayDate>${xmlEscape(pp.payDate)}</PayDate>`);
    lines.push(`      <InsurableEarnings>${centsToXmlAmount(pp.insurableEarningsCents)}</InsurableEarnings>`);
    lines.push(`      <InsurableHours>${pp.insurableHours.toFixed(1)}</InsurableHours>`);
    lines.push(`    </PayPeriod>`);
  }
  lines.push(`  </PayPeriodBreakdown>`);

  // ── Reason for ROE (Block 16) ────────────────────────────────────────────
  lines.push(`  <ReasonForROE>`);
  lines.push(`    <Code>${xmlEscape(roe.terminationCode)}</Code>`);
  lines.push(`    <Description>${xmlEscape(roe.terminationDescription)}</Description>`);
  lines.push(`  </ReasonForROE>`);

  // ── Expected Recall (Block 17) ───────────────────────────────────────────
  if (roe.expectedRecallDate) {
    lines.push(`  <ExpectedRecall>`);
    lines.push(`    <RecallDate>${xmlEscape(roe.expectedRecallDate)}</RecallDate>`);
    lines.push(`  </ExpectedRecall>`);
  }

  // ── Comments (Block 18) ──────────────────────────────────────────────────
  if (roe.comments) {
    lines.push(`  <Comments>`);
    lines.push(`    <![CDATA[${roe.comments}]]>`);
    lines.push(`  </Comments>`);
  }

  // ── Metadata ─────────────────────────────────────────────────────────────
  lines.push(`  <Metadata>`);
  lines.push(`    <GeneratedAt>${generatedTs}</GeneratedAt>`);
  lines.push(`    <DeliveryMethod>${xmlEscape(roe.deliveryMethod)}</DeliveryMethod>`);
  lines.push(`    <SoftwareVendor>Lulu Island Flagship — Financial Core v8.5</SoftwareVendor>`);
  lines.push(`  </Metadata>`);

  lines.push(`</ROE>`);

  return lines.join("\n");
}

// =========================================================================
// validateRoeXml()
// =========================================================================

/**
 * Resultado de la validación de un XML ROE.
 */
export interface RoeXmlValidationResult {
  /** true si el XML pasó todas las validaciones. */
  valid: boolean;
  /** Lista de errores encontrados. */
  errors: string[];
  /** Lista de advertencias. */
  warnings: string[];
}

/**
 * Valida la estructura de un XML ROE contra las reglas de Service Canada.
 *
 * Verifica estructura básica, elementos requeridos, y consistencia de datos.
 *
 * @param xml — string XML a validar.
 * @returns RoeXmlValidationResult con errores y advertencias.
 */
export function validateRoeXml(xml: string): RoeXmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!xml.trim().startsWith("<?xml")) {
    errors.push("XML no comienza con declaración <?xml?>.");
  }

  if (!xml.includes("<ROE")) {
    errors.push("Falta el elemento raíz <ROE>.");
  }

  if (!xml.includes("</ROE>")) {
    errors.push("Falta el cierre del elemento raíz </ROE>.");
  }

  const requiredElements = [
    "Employer",
    "Employee",
    "EmploymentPeriod",
    "InsurableDetails",
    "PayPeriodBreakdown",
    "ReasonForROE",
  ];

  for (const el of requiredElements) {
    if (!xml.includes(`<${el}>`)) {
      errors.push(`Falta la sección requerida <${el}>.`);
    }
  }

  // Check mandatory fields within sections
  if (!xml.includes("<SIN>")) {
    errors.push("Falta <SIN> del empleado en la sección <Employee>.");
  }

  if (!xml.includes("<FirstDayWorked>")) {
    errors.push("Falta <FirstDayWorked> en <EmploymentPeriod>.");
  }

  if (!xml.includes("<LastDayWorked>")) {
    errors.push("Falta <LastDayWorked> en <EmploymentPeriod>.");
  }

  if (!xml.includes("<Code>")) {
    errors.push("Falta <Code> de motivo de terminación en <ReasonForROE>.");
  }

  // Check PayPeriod count matches
  const ppCountMatch = xml.match(/<PayPeriodCount>(\d+)<\/PayPeriodCount>/);
  const ppMatches = xml.match(/<PayPeriod /g);
  if (ppCountMatch && ppMatches) {
    const declared = parseInt(ppCountMatch[1], 10);
    const actual = ppMatches.length;
    if (declared !== actual) {
      errors.push(
        `<PayPeriodCount> declara ${declared} pero hay ${actual} <PayPeriod> en el breakdown.`,
      );
    }
  }

  // Check that total >= final period
  const finalEarningsMatch = xml.match(/<FinalPeriodInsurableEarnings>([\d.]+)<\/FinalPeriodInsurableEarnings>/);
  const totalEarningsMatch = xml.match(/<TotalInsurableEarnings>([\d.]+)<\/TotalInsurableEarnings>/);
  if (finalEarningsMatch && totalEarningsMatch) {
    const final = parseFloat(finalEarningsMatch[1]);
    const total = parseFloat(totalEarningsMatch[1]);
    if (final > total) {
      errors.push(
        `FinalPeriodInsurableEarnings (${final.toFixed(2)}) excede TotalInsurableEarnings (${total.toFixed(2)}).`,
      );
    }
  }

  // Check termination code validity
  const codeMatch = xml.match(/<Code>([A-Z])<\/Code>/);
  if (codeMatch) {
    const code = codeMatch[1] as RoeTerminationCode;
    if (!ROE_TERMINATION_DESCRIPTIONS[code]) {
      warnings.push(`Código de terminación "${code}" no reconocido en la lista estándar de Service Canada.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =========================================================================
// ROE Summary (for admin dashboard)
// =========================================================================

/**
 * Resumen de ROEs emitidos en un período, para dashboard administrativo.
 */
export interface RoeSummary {
  /** Período de reporte. */
  periodStart: string;
  periodEnd: string;
  /** Total de ROEs emitidos en el período. */
  totalRoesIssued: number;
  /** Desglose por motivo de terminación. */
  byReason: Partial<Record<RoeTerminationCode, number>>;
  /** Timestamp de generación del summary. */
  generatedAt: string;
}

/**
 * Genera un resumen de ROEs emitidos.
 *
 * @param roes — array de ROEs emitidos en el período.
 * @param periodStart — inicio del período (YYYY-MM-DD).
 * @param periodEnd — fin del período (YYYY-MM-DD).
 * @returns RoeSummary con desglose por motivo.
 */
export function generateRoeSummary(
  roes: RecordOfEmployment[],
  periodStart: string,
  periodEnd: string,
): RoeSummary {
  const byReason: Partial<Record<RoeTerminationCode, number>> = {};

  for (const roe of roes) {
    byReason[roe.terminationCode] = (byReason[roe.terminationCode] ?? 0) + 1;
  }

  return {
    periodStart,
    periodEnd,
    totalRoesIssued: roes.length,
    byReason,
    generatedAt: new Date().toISOString(),
  };
}

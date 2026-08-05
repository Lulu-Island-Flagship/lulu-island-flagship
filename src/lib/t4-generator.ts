/**
 * v8.5 Capa 6 del Financial Core — T4 Generator.
 *
 * Genera T4 slips (Statement of Remuneration Paid) para empleados, el T4
 * Summary agregado, y el archivo XML de transmisión T619 requerido por CRA
 * para la presentación electrónica anual.
 *
 * Boxes CRA implementados (T4 slip estándar):
 *   Box 14 — Employment Income (gross pay anual)
 *   Box 16 — Employee CPP contributions
 *   Box 18 — Employee EI premiums
 *   Box 22 — Income Tax deducted (federal + provincial)
 *   Box 24 — EI insurable earnings
 *   Box 26 — CPP pensionable earnings
 *   Box 28 — Exempt (CPP/EI) — aplica a empleados exentos
 *   Box 44 — Union dues (si aplica)
 *   Box 46 — Charitable donations (si aplica)
 *   Box 50 — RPP contributions (si aplica)
 *   Box 52 — Pension adjustment (si aplica)
 *   Box 55 — Employee's PPIP premiums (si aplica)
 *   Box 56 — PPIP insurable earnings (si aplica)
 *
 * REGLA: todos los montos en centavos enteros (CAD). SIN nunca completo en
 * logs ni en código — solo últimos 3 dígitos visibles (formato *** *** 123).
 *
 * Interconexiones:
 *   t4-generator.ts ──(usa)──→ payroll-line.ts (PayrollLineaRow, maskSin)
 *   t4-generator.ts ──(usa)──→ compliance-resolver.ts (tasas CRA)
 *   t4-generator.ts ──(usado por)──→ tax-filing.ts
 */

import { maskSin, type PayrollLineaRow } from "./payroll-line";

// =========================================================================
// Employer Configuration — Lulu Island Flagship
// =========================================================================

/**
 * Datos del empleador para el T4.
 *
 * El Business Number (BN) de 15 caracteres es el identificador fiscal
 * de la empresa ante CRA: 9 dígitos + RP + 4 dígitos de programa.
 */
export const T4_EMPLOYER = {
  /** Razón social registrada ante CRA. */
  legalName: "Lulu Island Flagship Services Inc.",
  /** Nombre comercial (operating name). */
  operatingName: "Lulu Island Flagship",
  /** Dirección física del empleador. */
  address: {
    line1: "1231 Pacific Blvd",
    line2: "",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6Z 0E2",
    country: "CA",
  },
  /** Business Number de 15 caracteres (9 dígitos + RP + 0001). */
  businessNumber: "123456789RP0001",
  /** Número de cuenta de nómina de CRA (15 caracteres, mismo BN con sufijo de programa). */
  payrollAccountNumber: "123456789RP0001",
} as const;

// =========================================================================
// Tipos para datos de entrada del empleado
// =========================================================================

/**
 * Datos personales del empleado necesarios para el T4.
 *
 * El caller es responsable de proveer el SIN descifrado; esta función
 * solo lo usa para incluirlo en el XML (nunca en logs). El display en
 * la copia del empleado usa maskSin().
 */
export interface T4EmployeeInfo {
  /** UUID del empleado en la base de datos. */
  employeeId: string;
  /** Nombre legal completo (first + last). */
  legalName: string;
  /** Dirección postal del empleado. */
  address: {
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postalCode: string;
  };
  /** Social Insurance Number (9 dígitos) — solo para XML, nunca en logs. */
  sin: string;
  /** Provincia de empleo (para T4 provincial, default "BC"). */
  provinceOfEmployment?: string;
}

/**
 * Datos agregados del año calendario para un empleado.
 *
 * El caller (tax-filing.ts o ruta de exportación) agrega los YTD de la
 * tabla payroll_linea para el año fiscal solicitado y los provee aquí.
 * Todos los montos en centavos enteros CAD.
 */
export interface T4YearlyAggregate {
  /** Gross employment income del año (Box 14). */
  employmentIncomeCents: number;
  /** CPP contributions del empleado (Box 16). */
  cppEmployeeCents: number;
  /** CPP pensionable earnings (Box 26). Normalmente ≈ employmentIncomeCents
   *  limitado al YMPE del año. */
  cppPensionableEarningsCents: number;
  /** EI premiums del empleado (Box 18). */
  eiEmployeeCents: number;
  /** EI insurable earnings (Box 24). Normalmente ≈ employmentIncomeCents
   *  limitado al máximo asegurable del año. */
  eiInsurableEarningsCents: number;
  /** Income Tax deducted — federal + provincial (Box 22). */
  incomeTaxDeductedCents: number;
  /** Union dues pagados en el año (Box 44, opcional). */
  unionDuesCents?: number;
  /** Charitable donations vía payroll deduction (Box 46, opcional). */
  charitableDonationsCents?: number;
  /** RPP contributions (Box 50, opcional). */
  rppContributionsCents?: number;
  /** Pension adjustment amount (Box 52, opcional). */
  pensionAdjustmentCents?: number;
  /** Indica si el empleado está exento de CPP/EI (Box 28). */
  isCppEiExempt?: boolean;
}

// =========================================================================
// T4 Slip — estructura de salida
// =========================================================================

/**
 * Un T4 slip individual con todos los boxes CRA aplicables.
 *
 * Representa el Statement of Remuneration Paid para UN empleado en UN
 * año fiscal. Los montos están en centavos; el formateo a dólares ocurre
 * en la capa de presentación (PDF/XML).
 */
export interface T4Slip {
  /** Año fiscal del T4 (ej. 2026). */
  taxYear: number;
  /** UUID del empleado. */
  employeeId: string;
  /** Información del empleado (sin SIN visible — el SIN solo va al XML). */
  employee: {
    legalName: string;
    address: T4EmployeeInfo["address"];
    sinMasked: string;
    provinceOfEmployment: string;
  };
  /** Información del empleador. */
  employer: typeof T4_EMPLOYER;
  /** Boxes CRA con montos en centavos. */
  boxes: {
    box14: number; // Employment income
    box16: number; // Employee CPP contributions
    box18: number; // Employee EI premiums
    box22: number; // Income tax deducted
    box24: number; // EI insurable earnings
    box26: number; // CPP pensionable earnings
    box28: number; // Exempt (CPP/EI) — 0 = no exento
    box44: number; // Union dues
    box46: number; // Charitable donations
    box50: number; // RPP contributions
    box52: number; // Pension adjustment
    box55: number; // PPIP premiums (employee)
    box56: number; // PPIP insurable earnings
  };
  /** Timestamp de generación del slip. */
  generatedAt: string;
}

// =========================================================================
// T4 Summary — agregado de todos los slips
// =========================================================================

/**
 * T4 Summary: totaliza todos los T4 slips de un año fiscal.
 *
 * El T4 Summary se presenta junto con los slips individuales ante CRA.
 * Los totales deben cuadrar con las remesas mensuales de CPP/EI/Tax.
 */
export interface T4Summary {
  /** Año fiscal. */
  taxYear: number;
  /** Employer info. */
  employer: typeof T4_EMPLOYER;
  /** Número total de slips emitidos. */
  totalSlips: number;
  /** Totales agregados (centavos). */
  totals: {
    employmentIncomeCents: number;
    cppEmployeeCents: number;
    cppPensionableEarningsCents: number;
    eiEmployeeCents: number;
    eiInsurableEarningsCents: number;
    incomeTaxDeductedCents: number;
    unionDuesCents: number;
    charitableDonationsCents: number;
    rppContributionsCents: number;
    pensionAdjustmentCents: number;
  };
  /** Timestamp de generación. */
  generatedAt: string;
}

// =========================================================================
// generateT4Slip()
// =========================================================================

/**
 * Genera un T4 slip individual para un empleado.
 *
 * Función pura: no accede a base de datos. El caller provee los datos
 * agregados del año y la información personal del empleado. El SIN se
 * enmascara inmediatamente con maskSin().
 *
 * @param employee — información personal del empleado (incluye SIN descifrado).
 * @param yearData — datos agregados del año calendario en centavos.
 * @param taxYear — año fiscal para el T4 (ej. 2026).
 * @returns T4Slip con todos los boxes CRA aplicables.
 *
 * @example
 * ```ts
 * const slip = generateT4Slip(
 *   { employeeId: "uuid", legalName: "Jane Doe", address: {...}, sin: "123456789" },
 *   { employmentIncomeCents: 45_000_00, cppEmployeeCents: 2_500_00, ... },
 *   2026
 * );
 * // slip.employee.sinMasked === "*** *** 789"
 * // slip.boxes.box14 === 45_000_00
 * ```
 */
export function generateT4Slip(
  employee: T4EmployeeInfo,
  yearData: T4YearlyAggregate,
  taxYear: number,
): T4Slip {
  const sinMasked = maskSin(employee.sin);

  return {
    taxYear,
    employeeId: employee.employeeId,
    employee: {
      legalName: employee.legalName,
      address: { ...employee.address },
      sinMasked,
      provinceOfEmployment: employee.provinceOfEmployment ?? "BC",
    },
    employer: T4_EMPLOYER,
    boxes: {
      box14: yearData.employmentIncomeCents,
      box16: yearData.cppEmployeeCents,
      box18: yearData.eiEmployeeCents,
      box22: yearData.incomeTaxDeductedCents,
      box24: yearData.eiInsurableEarningsCents,
      box26: yearData.cppPensionableEarningsCents,
      box28: yearData.isCppEiExempt ? 1 : 0,
      box44: yearData.unionDuesCents ?? 0,
      box46: yearData.charitableDonationsCents ?? 0,
      box50: yearData.rppContributionsCents ?? 0,
      box52: yearData.pensionAdjustmentCents ?? 0,
      box55: 0, // PPIP no aplica en BC
      box56: 0, // PPIP no aplica en BC
    },
    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// generateT4Summary()
// =========================================================================

/**
 * Genera el T4 Summary a partir de un array de T4 slips.
 *
 * Totaliza todos los boxes relevantes y cuenta el número de slips.
 * El summary debe cuadrar con las remesas mensuales enviadas a CRA.
 *
 * @param slips — array de T4Slip generados para el año fiscal.
 * @param taxYear — año fiscal del summary.
 * @returns T4Summary con totales agregados.
 */
export function generateT4Summary(slips: T4Slip[], taxYear: number): T4Summary {
  const totals = slips.reduce(
    (acc, slip) => ({
      employmentIncomeCents: acc.employmentIncomeCents + slip.boxes.box14,
      cppEmployeeCents: acc.cppEmployeeCents + slip.boxes.box16,
      cppPensionableEarningsCents: acc.cppPensionableEarningsCents + slip.boxes.box26,
      eiEmployeeCents: acc.eiEmployeeCents + slip.boxes.box18,
      eiInsurableEarningsCents: acc.eiInsurableEarningsCents + slip.boxes.box24,
      incomeTaxDeductedCents: acc.incomeTaxDeductedCents + slip.boxes.box22,
      unionDuesCents: acc.unionDuesCents + slip.boxes.box44,
      charitableDonationsCents: acc.charitableDonationsCents + slip.boxes.box46,
      rppContributionsCents: acc.rppContributionsCents + slip.boxes.box50,
      pensionAdjustmentCents: acc.pensionAdjustmentCents + slip.boxes.box52,
    }),
    {
      employmentIncomeCents: 0,
      cppEmployeeCents: 0,
      cppPensionableEarningsCents: 0,
      eiEmployeeCents: 0,
      eiInsurableEarningsCents: 0,
      incomeTaxDeductedCents: 0,
      unionDuesCents: 0,
      charitableDonationsCents: 0,
      rppContributionsCents: 0,
      pensionAdjustmentCents: 0,
    },
  );

  return {
    taxYear,
    employer: T4_EMPLOYER,
    totalSlips: slips.length,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// XML helpers
// =========================================================================

/**
 * Escapa caracteres especiales para XML.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convierte centavos a formato string con 2 decimales para XML CRA.
 * CRA requiere montos en dólares con exactamente 2 decimales.
 *
 * Ejemplo: 4500000 → "45000.00"
 */
function centsToXmlAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

// =========================================================================
// generateT4Xml()
// =========================================================================

/**
 * Tipo de transmisión para el archivo T619 de CRA.
 */
export type T619TransmissionType = "O" | "A" | "T";

/**
 * Genera el archivo XML de transmisión T619 con los T4 slips incrustados.
 *
 * Formato: T619 (sobre de transmisión) + uno o más T4 slips. El schema
 * de CRA (T619_xx.xsd) define la estructura exacta. Este generador produce
 * XML compatible con el formato de Internet File Transfer (XML) de CRA.
 *
 * Estructura del XML generado:
 *   <T619>
 *     <Transmitter>...</Transmitter>
 *     <Return>
 *       <T4Slip>...</T4Slip>  (uno por empleado)
 *       <T4Summary>...</T4Summary>
 *     </Return>
 *   </T619>
 *
 * @param slips — array de T4Slip a incluir en la transmisión.
 * @param summary — T4Summary del año.
 * @param transmitterBN — Business Number del transmisor (si es distinto del empleador).
 * @param transmissionType — "O" (original), "A" (amended), "T" (test).
 * @returns string XML completo con declaración <?xml?>.
 */
export function generateT4Xml(
  slips: T4Slip[],
  summary: T4Summary,
  transmitterBN?: string,
  transmissionType: T619TransmissionType = "O",
): string {
  const bn = transmitterBN ?? T4_EMPLOYER.businessNumber;
  const now = new Date();
  const generatedDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const generatedTimestamp = now.toISOString();

  const lines: string[] = [];

  // XML declaration
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');

  // T619 root element
  lines.push(
    `<T619 xmlns="http://www.cra-arc.gc.ca/xml/t619/2026" submissionReferenceID="${generateSubmissionId(summary.taxYear, transmissionType)}" taxYear="${summary.taxYear}" transmissionType="${transmissionType}">`,
  );

  // ── Transmitter section ─────────────────────────────────────────────────
  lines.push(`  <Transmitter>`);
  lines.push(`    <BusinessNumber>${xmlEscape(bn)}</BusinessNumber>`);
  lines.push(`    <GeneratedDate>${generatedDate}</GeneratedDate>`);
  lines.push(`    <GeneratedTimestamp>${generatedTimestamp}</GeneratedTimestamp>`);
  lines.push(`    <SoftwareVendor>Lulu Island Flagship — Financial Core v8.5</SoftwareVendor>`);
  lines.push(`  </Transmitter>`);

  // ── Return section ──────────────────────────────────────────────────────
  lines.push(`  <Return>`);
  lines.push(`    <Employer>`);
  lines.push(`      <BusinessNumber>${xmlEscape(T4_EMPLOYER.businessNumber)}</BusinessNumber>`);
  lines.push(`      <LegalName>${xmlEscape(T4_EMPLOYER.legalName)}</LegalName>`);
  lines.push(`      <OperatingName>${xmlEscape(T4_EMPLOYER.operatingName)}</OperatingName>`);
  lines.push(`      <AddressLine1>${xmlEscape(T4_EMPLOYER.address.line1)}</AddressLine1>`);
  lines.push(`      <City>${xmlEscape(T4_EMPLOYER.address.city)}</City>`);
  lines.push(`      <Province>${xmlEscape(T4_EMPLOYER.address.province)}</Province>`);
  lines.push(`      <PostalCode>${xmlEscape(T4_EMPLOYER.address.postalCode)}</PostalCode>`);
  lines.push(`      <Country>${xmlEscape(T4_EMPLOYER.address.country)}</Country>`);
  lines.push(`    </Employer>`);

  // ── T4 Slips ────────────────────────────────────────────────────────────
  for (const slip of slips) {
    lines.push(`    <T4Slip>`);

    // Employee info
    lines.push(`      <Employee>`);
    lines.push(`        <SIN>${xmlEscape(slip.employee.sinMasked)}</SIN>`);
    lines.push(`        <LegalName>${xmlEscape(slip.employee.legalName)}</LegalName>`);
    lines.push(`        <AddressLine1>${xmlEscape(slip.employee.address.line1)}</AddressLine1>`);
    if (slip.employee.address.line2) {
      lines.push(`        <AddressLine2>${xmlEscape(slip.employee.address.line2)}</AddressLine2>`);
    }
    lines.push(`        <City>${xmlEscape(slip.employee.address.city)}</City>`);
    lines.push(`        <Province>${xmlEscape(slip.employee.address.province)}</Province>`);
    lines.push(`        <PostalCode>${xmlEscape(slip.employee.address.postalCode)}</PostalCode>`);
    lines.push(`      </Employee>`);

    // Box amounts (in dollars for CRA XML)
    lines.push(`      <Box14>${centsToXmlAmount(slip.boxes.box14)}</Box14>`);
    lines.push(`      <Box16>${centsToXmlAmount(slip.boxes.box16)}</Box16>`);
    lines.push(`      <Box18>${centsToXmlAmount(slip.boxes.box18)}</Box18>`);
    lines.push(`      <Box22>${centsToXmlAmount(slip.boxes.box22)}</Box22>`);
    lines.push(`      <Box24>${centsToXmlAmount(slip.boxes.box24)}</Box24>`);
    lines.push(`      <Box26>${centsToXmlAmount(slip.boxes.box26)}</Box26>`);
    if (slip.boxes.box28 > 0) {
      lines.push(`      <Box28>${centsToXmlAmount(slip.boxes.box28)}</Box28>`);
    }
    if (slip.boxes.box44 > 0) {
      lines.push(`      <Box44>${centsToXmlAmount(slip.boxes.box44)}</Box44>`);
    }
    if (slip.boxes.box46 > 0) {
      lines.push(`      <Box46>${centsToXmlAmount(slip.boxes.box46)}</Box46>`);
    }
    if (slip.boxes.box50 > 0) {
      lines.push(`      <Box50>${centsToXmlAmount(slip.boxes.box50)}</Box50>`);
    }
    if (slip.boxes.box52 > 0) {
      lines.push(`      <Box52>${centsToXmlAmount(slip.boxes.box52)}</Box52>`);
    }

    lines.push(`    </T4Slip>`);
  }

  // ── T4 Summary ──────────────────────────────────────────────────────────
  lines.push(`    <T4Summary>`);
  lines.push(`      <TotalSlips>${summary.totalSlips}</TotalSlips>`);
  lines.push(`      <TotalBox14>${centsToXmlAmount(summary.totals.employmentIncomeCents)}</TotalBox14>`);
  lines.push(`      <TotalBox16>${centsToXmlAmount(summary.totals.cppEmployeeCents)}</TotalBox16>`);
  lines.push(`      <TotalBox18>${centsToXmlAmount(summary.totals.eiEmployeeCents)}</TotalBox18>`);
  lines.push(`      <TotalBox22>${centsToXmlAmount(summary.totals.incomeTaxDeductedCents)}</TotalBox22>`);
  lines.push(`      <TotalBox24>${centsToXmlAmount(summary.totals.eiInsurableEarningsCents)}</TotalBox24>`);
  lines.push(`      <TotalBox26>${centsToXmlAmount(summary.totals.cppPensionableEarningsCents)}</TotalBox26>`);
  if (summary.totals.unionDuesCents > 0) {
    lines.push(`      <TotalBox44>${centsToXmlAmount(summary.totals.unionDuesCents)}</TotalBox44>`);
  }
  if (summary.totals.charitableDonationsCents > 0) {
    lines.push(`      <TotalBox46>${centsToXmlAmount(summary.totals.charitableDonationsCents)}</TotalBox46>`);
  }
  if (summary.totals.rppContributionsCents > 0) {
    lines.push(`      <TotalBox50>${centsToXmlAmount(summary.totals.rppContributionsCents)}</TotalBox50>`);
  }
  if (summary.totals.pensionAdjustmentCents > 0) {
    lines.push(`      <TotalBox52>${centsToXmlAmount(summary.totals.pensionAdjustmentCents)}</TotalBox52>`);
  }
  lines.push(`    </T4Summary>`);

  lines.push(`  </Return>`);
  lines.push(`</T619>`);

  return lines.join("\n");
}

/**
 * Genera un submission reference ID único para la transmisión.
 * Formato: T4-{taxYear}-{type}-{timestamp}
 *
 * @internal
 */
function generateSubmissionId(taxYear: number, type: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `T4-${taxYear}-${type}-${ts}`;
}

// =========================================================================
// validateT4Xml()
// =========================================================================

/**
 * Resultado de la validación de un XML T4.
 */
export interface T4XmlValidationResult {
  /** true si el XML pasó todas las validaciones. */
  valid: boolean;
  /** Lista de errores encontrados (vacía si valid === true). */
  errors: string[];
  /** Lista de advertencias (no bloquean, pero deben revisarse). */
  warnings: string[];
}

/**
 * Valida la estructura de un XML T4 contra las reglas de negocio de CRA.
 *
 * Esta validación es estructural y semántica (no valida contra el XSD
 * oficial de CRA, que requiere un parser externo). Verifica:
 *   - Que el XML sea parseable.
 *   - Que contenga los elementos requeridos (T619, Return, Employer).
 *   - Que todos los T4 slips tengan los boxes obligatorios.
 *   - Que los totales del summary cuadren con la suma de slips.
 *
 * Para validación XSD completa, usar una herramienta como xmllint con
 * el schema oficial de CRA.
 *
 * @param xml — string XML a validar.
 * @returns T4XmlValidationResult con errores y advertencias.
 */
export function validateT4Xml(xml: string): T4XmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Structural checks (regex-based, no heavy XML parser dependency)
  if (!xml.trim().startsWith("<?xml")) {
    errors.push("XML no comienza con declaración <?xml?>.");
  }

  if (!xml.includes("<T619")) {
    errors.push("Falta el elemento raíz <T619>.");
  }

  if (!xml.includes("</T619>")) {
    errors.push("Falta el cierre del elemento raíz </T619>.");
  }

  if (!xml.includes("<Employer>")) {
    errors.push("Falta la sección <Employer> con datos del empleador.");
  }

  if (!xml.includes("<BusinessNumber>")) {
    errors.push("Falta <BusinessNumber> del empleador.");
  }

  if (!xml.includes("<T4Slip>")) {
    warnings.push("No se encontraron <T4Slip> — ¿no hay empleados para este año?");
  }

  if (!xml.includes("<T4Summary>")) {
    errors.push("Falta la sección <T4Summary>.");
  }

  // Check mandatory boxes in each T4 slip
  const slipMatches = xml.match(/<T4Slip>/g);
  if (slipMatches) {
    const mandatoryBoxes = ["Box14", "Box16", "Box18", "Box22", "Box24", "Box26"];
    let slipIndex = 0;
    const slipSections = xml.split("<T4Slip>").slice(1);
    for (const section of slipSections) {
      slipIndex++;
      const slipContent = section.split("</T4Slip>")[0] ?? "";
      for (const box of mandatoryBoxes) {
        if (!slipContent.includes(`<${box}>`)) {
          errors.push(`T4Slip #${slipIndex}: falta el box obligatorio <${box}>.`);
        }
      }
      // Check SIN format
      const sinMatch = slipContent.match(/<SIN>(.+?)<\/SIN>/);
      if (sinMatch) {
        const sinValue = sinMatch[1];
        if (!/^\*\*\* \*\*\* \d{3}$/.test(sinValue) && !/^\d{9}$/.test(sinValue)) {
          warnings.push(
            `T4Slip #${slipIndex}: SIN con formato inesperado "${sinValue}". Esperado: *** *** 123 o 9 dígitos.`,
          );
        }
      }
    }
  }

  // Check that totals in summary match slip sums (basic numeric sanity)
  const box14Sums = extractBoxValues(xml, "Box14");
  const totalBox14Match = xml.match(/<TotalBox14>([\d.]+)<\/TotalBox14>/);
  if (box14Sums.length > 0 && totalBox14Match) {
    const slipSum = box14Sums.reduce((a, b) => a + b, 0);
    const summaryTotal = parseFloat(totalBox14Match[1]);
    if (Math.abs(slipSum - summaryTotal) > 0.02) {
      errors.push(
        `TotalBox14 (${summaryTotal.toFixed(2)}) no cuadra con la suma de Box14 de los slips (${slipSum.toFixed(2)}).`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Extrae valores numéricos de un box específico en el XML.
 *
 * @internal
 */
function extractBoxValues(xml: string, boxName: string): number[] {
  const regex = new RegExp(`<${boxName}>([\\d.]+)<\\/${boxName}>`, "g");
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    values.push(parseFloat(match[1]));
  }
  return values;
}

// =========================================================================
// YTD aggregation helper
// =========================================================================

/**
 * Agrega las líneas de payroll_linea de un empleado para un año fiscal
 * y produce un T4YearlyAggregate listo para generateT4Slip().
 *
 * Esta función es pura: recibe un array de PayrollLineaRow (ya filtrado
 * por empleado y año por el caller) y devuelve los totales agregados.
 *
 * @param lineas — líneas de nómina del empleado para el año fiscal.
 * @returns T4YearlyAggregate con todos los totales en centavos.
 *
 * @example
 * ```ts
 * // El caller filtra por employee_id y año antes de llamar:
 * const lineasDelAnio = allLineas.filter(
 *   l => l.employee_id === empId && l.creado_en.startsWith("2026")
 * );
 * const aggregate = aggregateYearlyLines(lineasDelAnio);
 * const slip = generateT4Slip(employeeInfo, aggregate, 2026);
 * ```
 */
export function aggregateYearlyLines(lineas: PayrollLineaRow[]): T4YearlyAggregate {
  let employmentIncomeCents = 0;
  let cppEmployeeCents = 0;
  let cppPensionableEarningsCents = 0;
  let eiEmployeeCents = 0;
  let eiInsurableEarningsCents = 0;
  let incomeTaxDeductedCents = 0;

  for (const linea of lineas) {
    employmentIncomeCents += linea.gross_cents;
    cppEmployeeCents += linea.cpp_empleado;
    // CPP pensionable earnings ≈ gross (el calculator ya aplica el tope YMPE)
    cppPensionableEarningsCents += linea.gross_cents;
    eiEmployeeCents += linea.ei_empleado;
    // EI insurable earnings ≈ gross (el calculator ya aplica el tope)
    eiInsurableEarningsCents += linea.gross_cents;
    incomeTaxDeductedCents += linea.tax_federal + linea.tax_provincial;
  }

  return {
    employmentIncomeCents,
    cppEmployeeCents,
    cppPensionableEarningsCents,
    eiEmployeeCents,
    eiInsurableEarningsCents,
    incomeTaxDeductedCents,
  };
}

/**
 * v8.5 Capa 6 del Financial Core — T4A Generator.
 *
 * Genera T4A slips (Statement of Pension, Retirement, Annuity, and Other
 * Income) para partners, property managers, y otros receptores de pagos
 * que NO son empleados. El T4A es obligatorio para cualquier pago a
 * no-empleados que supere $500 en el año calendario (CRA).
 *
 * Boxes CRA implementados (T4A slip):
 *   Box 020 — Self-employed commissions
 *   Box 048 — Fees for services
 *   Box 016 — Pension or superannuation (si aplica)
 *   Box 022 — Income tax deducted (si hubo retención en la fuente)
 *   Box 028 — Other income (catch-all para tipos no estándar)
 *
 * Tipos de partner cubiertos (ver partner-commissions.ts):
 *   - real_estate_agent    → Box 020 (Self-employed commissions, 10% primera reserva)
 *   - property_manager     → Box 048 (Fees for services, 5% recurrente)
 *   - veterinarian         → Box 048 (Fees for services, $20 fijo por referral)
 *   - builder              → Box 020 (Self-employed commissions, 15% de orden)
 *
 * REGLA: todos los montos en centavos enteros (CAD). SIN/BN del receptor
 * nunca completo en logs — solo últimos 3 dígitos visibles.
 *
 * Interconexiones:
 *   t4a-generator.ts ──(alineado con)──→ partner-commissions.ts
 *   t4a-generator.ts ──(usado por)──→ tax-filing.ts
 */

import { type PartnerType } from "./partner-commissions";

// =========================================================================
// Employer / Payer Configuration
// =========================================================================

/**
 * Datos del pagador (payer) para el T4A. Misma entidad que el T4 employer.
 */
export const T4A_PAYER = {
  legalName: "Lulu Island Flagship Services Inc.",
  operatingName: "Lulu Island Flagship",
  address: {
    line1: "1231 Pacific Blvd",
    line2: "",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6Z 0E2",
    country: "CA",
  },
  businessNumber: "123456789RP0001",
} as const;

// =========================================================================
// Input types
// =========================================================================

/**
 * Información del receptor del T4A (partner / no-empleado).
 */
export interface T4ARecipientInfo {
  /** UUID del partner en la base de datos. */
  partnerId: string;
  /** Nombre legal completo o razón social del receptor. */
  legalName: string;
  /** Tipo de partner (determina el box de CRA aplicable). */
  partnerType: PartnerType;
  /** Dirección postal del receptor. */
  address: {
    line1: string;
    line2?: string;
    city: string;
    province: string;
    postalCode: string;
  };
  /**
   * Business Number del receptor (15 caracteres) o SIN (9 dígitos).
   * Para empresas registradas, usar BN; para individuos, SIN.
   * Este valor va al XML de CRA pero NUNCA aparece en logs.
   */
  recipientBN: string;
  /** Si es true, el identificador es BN (business); si false, es SIN (individual). */
  isBusinessNumber: boolean;
}

/**
 * Datos agregados del año calendario para un receptor de T4A.
 *
 * El caller agrega los pagos del año desde la tabla de partner_commissions
 * o equivalente. Todos los montos en centavos enteros CAD.
 */
export interface T4AYearlyAggregate {
  /** Total de comisiones auto-empleadas (Box 020). */
  selfEmployedCommissionsCents: number;
  /** Total de fees for services (Box 048). */
  feesForServicesCents: number;
  /** Income tax deducted at source, si aplica (Box 022). */
  incomeTaxDeductedCents: number;
  /** Otros ingresos no clasificados (Box 028). */
  otherIncomeCents: number;
  /** Pension or superannuation (Box 016). */
  pensionOrSuperannuationCents: number;
}

// =========================================================================
// T4A Slip — estructura de salida
// =========================================================================

/**
 * Un T4A slip individual para un receptor (partner / no-empleado).
 *
 * Los montos están en centavos; el formateo a dólares ocurre en la
 * capa de presentación (PDF/XML).
 */
export interface T4ASlip {
  /** Año fiscal del T4A (ej. 2026). */
  taxYear: number;
  /** UUID del partner. */
  partnerId: string;
  /** Tipo de partner (para referencia interna). */
  partnerType: PartnerType;
  /** Información del receptor (sin identificador fiscal visible). */
  recipient: {
    legalName: string;
    address: T4ARecipientInfo["address"];
    /** "BN 123456789" o "SIN *** *** 789" — para display interno. */
    identifierDisplay: string;
  };
  /** Información del pagador. */
  payer: typeof T4A_PAYER;
  /** Boxes CRA con montos en centavos. */
  boxes: {
    box016: number; // Pension or superannuation
    box020: number; // Self-employed commissions
    box022: number; // Income tax deducted
    box028: number; // Other income
    box048: number; // Fees for services
  };
  /** Timestamp de generación del slip. */
  generatedAt: string;
}

// =========================================================================
// T4A Summary — agregado de todos los slips
// =========================================================================

/**
 * T4A Summary: totaliza todos los T4A slips de un año fiscal.
 */
export interface T4ASummary {
  /** Año fiscal. */
  taxYear: number;
  /** Payer info. */
  payer: typeof T4A_PAYER;
  /** Número total de slips T4A emitidos. */
  totalSlips: number;
  /** Totales agregados (centavos). */
  totals: {
    selfEmployedCommissionsCents: number;
    feesForServicesCents: number;
    incomeTaxDeductedCents: number;
    otherIncomeCents: number;
    pensionOrSuperannuationCents: number;
  };
  /** Timestamp de generación. */
  generatedAt: string;
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Enmascara un identificador fiscal para display.
 *
 * Para BN (15 caracteres): muestra "BN " + últimos 4 dígitos.
 * Para SIN (9 dígitos): muestra "SIN *** *** 123".
 *
 * @param identifier — BN o SIN en texto plano (sin guiones ni espacios).
 * @param isBusinessNumber — true si es BN, false si es SIN.
 * @returns Identificador enmascarado para display.
 */
export function maskRecipientIdentifier(identifier: string, isBusinessNumber: boolean): string {
  const cleaned = identifier.replace(/\s|-/g, "");
  if (isBusinessNumber) {
    // BN: 15 chars (9 digits + RP + 4 digits). Show "BN " + last 4.
    if (cleaned.length >= 4) {
      return `BN ${cleaned.slice(-4)}`;
    }
    return `BN ${cleaned}`;
  }
  // SIN: 9 digits. Show "SIN *** *** 123"
  if (cleaned.length === 9) {
    return `SIN *** *** ${cleaned.slice(-3)}`;
  }
  return `SIN *** *** ***`;
}

// =========================================================================
// generateT4ASlip()
// =========================================================================

/**
 * Genera un T4A slip individual para un partner / no-empleado.
 *
 * Función pura: no accede a base de datos. El caller provee los datos
 * agregados del año y la información del receptor. El identificador fiscal
 * se enmascara inmediatamente para display.
 *
 * @param recipient — información del receptor (partner).
 * @param yearData — datos agregados del año en centavos.
 * @param taxYear — año fiscal (ej. 2026).
 * @returns T4ASlip con todos los boxes CRA aplicables.
 *
 * @example
 * ```ts
 * const slip = generateT4ASlip(
 *   {
 *     partnerId: "uuid",
 *     legalName: "BC Property Management Inc.",
 *     partnerType: "property_manager",
 *     address: {...},
 *     recipientBN: "987654321RP0001",
 *     isBusinessNumber: true,
 *   },
 *   { feesForServicesCents: 12_000_00, ... },
 *   2026
 * );
 * // slip.recipient.identifierDisplay === "BN 0001"
 * // slip.boxes.box048 === 12_000_00
 * ```
 */
export function generateT4ASlip(
  recipient: T4ARecipientInfo,
  yearData: T4AYearlyAggregate,
  taxYear: number,
): T4ASlip {
  const identifierDisplay = maskRecipientIdentifier(recipient.recipientBN, recipient.isBusinessNumber);

  return {
    taxYear,
    partnerId: recipient.partnerId,
    partnerType: recipient.partnerType,
    recipient: {
      legalName: recipient.legalName,
      address: { ...recipient.address },
      identifierDisplay,
    },
    payer: T4A_PAYER,
    boxes: {
      box016: yearData.pensionOrSuperannuationCents,
      box020: yearData.selfEmployedCommissionsCents,
      box022: yearData.incomeTaxDeductedCents,
      box028: yearData.otherIncomeCents,
      box048: yearData.feesForServicesCents,
    },
    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// generateT4ASummary()
// =========================================================================

/**
 * Genera el T4A Summary a partir de un array de T4A slips.
 *
 * Totaliza todos los boxes relevantes y cuenta el número de slips.
 *
 * @param slips — array de T4ASlip generados para el año fiscal.
 * @param taxYear — año fiscal del summary.
 * @returns T4ASummary con totales agregados.
 */
export function generateT4ASummary(slips: T4ASlip[], taxYear: number): T4ASummary {
  const totals = slips.reduce(
    (acc, slip) => ({
      selfEmployedCommissionsCents: acc.selfEmployedCommissionsCents + slip.boxes.box020,
      feesForServicesCents: acc.feesForServicesCents + slip.boxes.box048,
      incomeTaxDeductedCents: acc.incomeTaxDeductedCents + slip.boxes.box022,
      otherIncomeCents: acc.otherIncomeCents + slip.boxes.box028,
      pensionOrSuperannuationCents: acc.pensionOrSuperannuationCents + slip.boxes.box016,
    }),
    {
      selfEmployedCommissionsCents: 0,
      feesForServicesCents: 0,
      incomeTaxDeductedCents: 0,
      otherIncomeCents: 0,
      pensionOrSuperannuationCents: 0,
    },
  );

  return {
    taxYear,
    payer: T4A_PAYER,
    totalSlips: slips.length,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// Mapeo de PartnerType → Box CRA
// =========================================================================

/**
 * Determina qué box de CRA corresponde a cada tipo de partner.
 *
 * - real_estate_agent: Box 020 (comisiones de auto-empleado)
 * - property_manager: Box 048 (fees for services)
 * - veterinarian: Box 048 (fees for services, referral fee fijo)
 * - builder: Box 020 (comisiones de auto-empleado)
 */
export function partnerTypeToT4ABox(partnerType: PartnerType): "box020" | "box048" {
  switch (partnerType) {
    case "real_estate_agent":
    case "builder":
      return "box020";
    case "property_manager":
    case "veterinarian":
      return "box048";
    default:
      // fallback: fees for services
      return "box048";
  }
}

/**
 * Prepara un T4AYearlyAggregate a partir de un monto total de comisiones
 * y el tipo de partner, ubicando el monto en el box correcto.
 *
 * Útil cuando el caller solo tiene el total pagado y quiere construir
 * el aggregate rápidamente sin preocuparse por la clasificación manual.
 *
 * @param totalCents — monto total pagado al partner en el año (centavos).
 * @param partnerType — tipo de partner.
 * @param incomeTaxDeductedCents — tax retenido en la fuente, si aplica (default 0).
 * @returns T4AYearlyAggregate con el monto en el box correcto.
 */
export function buildT4AAggregate(
  totalCents: number,
  partnerType: PartnerType,
  incomeTaxDeductedCents: number = 0,
): T4AYearlyAggregate {
  const box = partnerTypeToT4ABox(partnerType);
  return {
    selfEmployedCommissionsCents: box === "box020" ? totalCents : 0,
    feesForServicesCents: box === "box048" ? totalCents : 0,
    incomeTaxDeductedCents,
    otherIncomeCents: 0,
    pensionOrSuperannuationCents: 0,
  };
}

// =========================================================================
// XML helpers
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

// =========================================================================
// generateT4AXml()
// =========================================================================

/**
 * Tipo de transmisión para el archivo T4A de CRA.
 */
export type T4ATransmissionType = "O" | "A" | "T";

/**
 * Genera el archivo XML de transmisión para T4A slips.
 *
 * Formato: similar al T619 del T4 pero adaptado para T4A slips. La
 * estructura sigue el estándar de Internet File Transfer (XML) de CRA
 * para T4A returns.
 *
 * @param slips — array de T4ASlip a incluir.
 * @param summary — T4ASummary del año.
 * @param transmitterBN — Business Number del transmisor.
 * @param transmissionType — "O" (original), "A" (amended), "T" (test).
 * @returns string XML completo.
 */
export function generateT4AXml(
  slips: T4ASlip[],
  summary: T4ASummary,
  transmitterBN?: string,
  transmissionType: T4ATransmissionType = "O",
): string {
  const bn = transmitterBN ?? T4A_PAYER.businessNumber;
  const now = new Date();
  const generatedDate = now.toISOString().slice(0, 10);
  const generatedTimestamp = now.toISOString();

  const lines: string[] = [];

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<T4AReturn xmlns="http://www.cra-arc.gc.ca/xml/t4a/2026" submissionReferenceID="${generateT4ASubmissionId(summary.taxYear, transmissionType)}" taxYear="${summary.taxYear}" transmissionType="${transmissionType}">`,
  );

  // ── Transmitter ──────────────────────────────────────────────────────────
  lines.push(`  <Transmitter>`);
  lines.push(`    <BusinessNumber>${xmlEscape(bn)}</BusinessNumber>`);
  lines.push(`    <GeneratedDate>${generatedDate}</GeneratedDate>`);
  lines.push(`    <GeneratedTimestamp>${generatedTimestamp}</GeneratedTimestamp>`);
  lines.push(`    <SoftwareVendor>Lulu Island Flagship — Financial Core v8.5</SoftwareVendor>`);
  lines.push(`  </Transmitter>`);

  // ── Payer ────────────────────────────────────────────────────────────────
  lines.push(`  <Payer>`);
  lines.push(`    <BusinessNumber>${xmlEscape(T4A_PAYER.businessNumber)}</BusinessNumber>`);
  lines.push(`    <LegalName>${xmlEscape(T4A_PAYER.legalName)}</LegalName>`);
  lines.push(`    <OperatingName>${xmlEscape(T4A_PAYER.operatingName)}</OperatingName>`);
  lines.push(`    <AddressLine1>${xmlEscape(T4A_PAYER.address.line1)}</AddressLine1>`);
  lines.push(`    <City>${xmlEscape(T4A_PAYER.address.city)}</City>`);
  lines.push(`    <Province>${xmlEscape(T4A_PAYER.address.province)}</Province>`);
  lines.push(`    <PostalCode>${xmlEscape(T4A_PAYER.address.postalCode)}</PostalCode>`);
  lines.push(`    <Country>${xmlEscape(T4A_PAYER.address.country)}</Country>`);
  lines.push(`  </Payer>`);

  // ── T4A Slips ────────────────────────────────────────────────────────────
  for (const slip of slips) {
    lines.push(`  <T4ASlip>`);

    // Recipient info
    lines.push(`    <Recipient>`);
    lines.push(`      <LegalName>${xmlEscape(slip.recipient.legalName)}</LegalName>`);
    lines.push(`      <Identifier>${xmlEscape(slip.recipient.identifierDisplay)}</Identifier>`);
    lines.push(`      <AddressLine1>${xmlEscape(slip.recipient.address.line1)}</AddressLine1>`);
    if (slip.recipient.address.line2) {
      lines.push(`      <AddressLine2>${xmlEscape(slip.recipient.address.line2)}</AddressLine2>`);
    }
    lines.push(`      <City>${xmlEscape(slip.recipient.address.city)}</City>`);
    lines.push(`      <Province>${xmlEscape(slip.recipient.address.province)}</Province>`);
    lines.push(`      <PostalCode>${xmlEscape(slip.recipient.address.postalCode)}</PostalCode>`);
    lines.push(`      <PartnerType>${xmlEscape(slip.partnerType)}</PartnerType>`);
    lines.push(`    </Recipient>`);

    // Box amounts (only non-zero boxes per CRA convention)
    if (slip.boxes.box016 > 0) {
      lines.push(`    <Box016>${centsToXmlAmount(slip.boxes.box016)}</Box016>`);
    }
    if (slip.boxes.box020 > 0) {
      lines.push(`    <Box020>${centsToXmlAmount(slip.boxes.box020)}</Box020>`);
    }
    if (slip.boxes.box022 > 0) {
      lines.push(`    <Box022>${centsToXmlAmount(slip.boxes.box022)}</Box022>`);
    }
    if (slip.boxes.box028 > 0) {
      lines.push(`    <Box028>${centsToXmlAmount(slip.boxes.box028)}</Box028>`);
    }
    if (slip.boxes.box048 > 0) {
      lines.push(`    <Box048>${centsToXmlAmount(slip.boxes.box048)}</Box048>`);
    }

    lines.push(`  </T4ASlip>`);
  }

  // ── T4A Summary ──────────────────────────────────────────────────────────
  lines.push(`  <T4ASummary>`);
  lines.push(`    <TotalSlips>${summary.totalSlips}</TotalSlips>`);
  if (summary.totals.pensionOrSuperannuationCents > 0) {
    lines.push(`    <TotalBox016>${centsToXmlAmount(summary.totals.pensionOrSuperannuationCents)}</TotalBox016>`);
  }
  if (summary.totals.selfEmployedCommissionsCents > 0) {
    lines.push(`    <TotalBox020>${centsToXmlAmount(summary.totals.selfEmployedCommissionsCents)}</TotalBox020>`);
  }
  if (summary.totals.incomeTaxDeductedCents > 0) {
    lines.push(`    <TotalBox022>${centsToXmlAmount(summary.totals.incomeTaxDeductedCents)}</TotalBox022>`);
  }
  if (summary.totals.otherIncomeCents > 0) {
    lines.push(`    <TotalBox028>${centsToXmlAmount(summary.totals.otherIncomeCents)}</TotalBox028>`);
  }
  if (summary.totals.feesForServicesCents > 0) {
    lines.push(`    <TotalBox048>${centsToXmlAmount(summary.totals.feesForServicesCents)}</TotalBox048>`);
  }
  lines.push(`  </T4ASummary>`);

  lines.push(`</T4AReturn>`);

  return lines.join("\n");
}

function generateT4ASubmissionId(taxYear: number, type: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `T4A-${taxYear}-${type}-${ts}`;
}

// =========================================================================
// validateT4AXml()
// =========================================================================

/**
 * Resultado de la validación de un XML T4A.
 */
export interface T4AXmlValidationResult {
  /** true si el XML pasó todas las validaciones. */
  valid: boolean;
  /** Lista de errores encontrados. */
  errors: string[];
  /** Lista de advertencias. */
  warnings: string[];
}

/**
 * Valida la estructura de un XML T4A contra las reglas de negocio de CRA.
 *
 * Verifica estructura básica, elementos requeridos, y consistencia de
 * totales summary vs slips individuales.
 *
 * @param xml — string XML a validar.
 * @returns T4AXmlValidationResult con errores y advertencias.
 */
export function validateT4AXml(xml: string): T4AXmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!xml.trim().startsWith("<?xml")) {
    errors.push("XML no comienza con declaración <?xml?>.");
  }

  if (!xml.includes("<T4AReturn")) {
    errors.push("Falta el elemento raíz <T4AReturn>.");
  }

  if (!xml.includes("</T4AReturn>")) {
    errors.push("Falta el cierre del elemento raíz </T4AReturn>.");
  }

  if (!xml.includes("<Payer>")) {
    errors.push("Falta la sección <Payer> con datos del pagador.");
  }

  if (!xml.includes("<BusinessNumber>")) {
    errors.push("Falta <BusinessNumber> del pagador.");
  }

  if (!xml.includes("<T4ASlip>")) {
    warnings.push("No se encontraron <T4ASlip> — ¿no hay partners con pagos este año?");
  }

  if (!xml.includes("<T4ASummary>")) {
    errors.push("Falta la sección <T4ASummary>.");
  }

  // Check that each slip has at least one non-zero box
  const slipSections = xml.split("<T4ASlip>").slice(1);
  let slipIndex = 0;
  const t4aBoxes = ["Box016", "Box020", "Box022", "Box028", "Box048"];
  for (const section of slipSections) {
    slipIndex++;
    const slipContent = section.split("</T4ASlip>")[0] ?? "";
    const hasAnyBox = t4aBoxes.some((box) => slipContent.includes(`<${box}>`));
    if (!hasAnyBox) {
      errors.push(`T4ASlip #${slipIndex}: no contiene ningún box con monto.`);
    }
  }

  // Check summary totals
  for (const box of t4aBoxes) {
    const totalMatch = xml.match(new RegExp(`<Total${box}>([\\d.]+)<\\/Total${box}>`));
    if (totalMatch) {
      const slipValues = extractT4ABoxValues(xml, box);
      const slipSum = slipValues.reduce((a, b) => a + b, 0);
      const summaryTotal = parseFloat(totalMatch[1]);
      if (Math.abs(slipSum - summaryTotal) > 0.02) {
        errors.push(
          `Total${box} (${summaryTotal.toFixed(2)}) no cuadra con la suma de ${box} (${slipSum.toFixed(2)}).`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function extractT4ABoxValues(xml: string, boxName: string): number[] {
  const regex = new RegExp(`<${boxName}>([\\d.]+)<\\/${boxName}>`, "g");
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    values.push(parseFloat(match[1]));
  }
  return values;
}

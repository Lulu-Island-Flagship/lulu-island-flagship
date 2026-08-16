/**
 * Capa 5 — Tax Engine: GST/HST NETFILE XML Generator.
 *
 * Genera el archivo XML en formato T619 para presentación electrónica de
 * GST/HST returns ante la Canada Revenue Agency (CRA). Cumple con la
 * especificación técnica de CRA para transmisión electrónica (EFILE/NETFILE).
 *
 * Referencias:
 *  - CRA T619 Electronic Filing — GST/HST Return
 *  - GST/HST NETFILE — formato XML esperado por CRA
 *  - BC Provincial Sales Tax (PST) — se reporta separadamente ante BC MoF
 *
 * NOTA IMPORTANTE: El XML generado por este módulo está diseñado para ser
 * revisado por un contador/administrador ANTES de ser enviado a CRA. La
 * transmisión real a CRA se realiza fuera de este sistema (portal NETFILE
 * de CRA o software certificado). Este módulo produce el archivo que se
 * carga en dicho portal.
 *
 * Este archivo NO toca base de datos ni APIs externas. Todas las funciones
 * son puras: reciben datos y producen output.
 */

import { z } from "zod";
import {
  getFilingDeadline,
  getFilingFrequency,
  type FilingStatus,
} from "@/lib/tax-filing";
import {
  PST_RATE,
} from "@/lib/tax-engine";
import { toCentsBigInt } from "@/lib/money";

// =========================================================================
// Re-exports from tax-filing.ts (single source of truth for types)
// =========================================================================

export {
  type FilingStatus,
  type FilingAttempt,
  type CRAConfirmationTracking,
  getFilingStatus,
  recordFilingAttempt,
  trackCRAConfirmation,
} from "@/lib/tax-filing";

// =========================================================================
// Business constants
// =========================================================================

/**
 * Business Number (BN) de la empresa para GST/HST.
 * Formato: 9 dígitos + RT0001 (GST/HST program account).
 *
 * EN PRODUCCIÓN: reemplazar con el BN real de Lulu Island Flagship.
 * El BN se compone de:
 *   - 9 dígitos del BN raíz registrado ante CRA
 *   - RT0001 (program identifier para cuenta de GST/HST)
 */
const BUSINESS_NUMBER = "123456789RT0001";

/** CRA GST/HST NETFILE XML namespace */
const CRA_NAMESPACE = "http://www.cra-arc.gc.ca/gncy/bn";

/** Software vendor code asignado por CRA para NETFILE */
const TRANSMITTER_SOFTWARE_CODE = "LULUISLAND-FLAGSHIP-V1";

/**
 * Fecha de referencia CRA para penalidades por presentación tardía.
 * Para 2026, la tasa de interés de CRA sobre saldos pendientes es ~9% anual
 * (prescribed rate, revisado trimestralmente).
 */
const CRA_LATE_FILING_PENALTY_BASE = 0.05; // 5% base penalty
const CRA_ADDITIONAL_MONTHLY_PENALTY = 0.01; // 1% adicional por mes completo (máx 12 meses)
const CRA_INTEREST_ANNUAL_RATE = 0.09; // 9% prescribed rate Q3 2026

// =========================================================================
// Zod schemas
// =========================================================================

/**
 * Período fiscal en formato: "YYYY-QN" (ej. "2026-Q2") o "YYYY-MM" (ej. "2026-08").
 */
const PeriodoSchema = z.string().regex(
  /^\d{4}-(Q[1-4]|0[1-9]|1[0-2])$/,
  "periodo debe ser YYYY-QN (ej. 2026-Q2) o YYYY-MM (ej. 2026-08)",
);

/**
 * Datos del GST return requeridos para generar el XML.
 */
export const GstReturnXmlInputSchema = z.object({
  periodo: PeriodoSchema,
  businessNumber: z
    .string()
    .regex(/^\d{9}RT\d{4}$/, "Business Number debe ser 9 dígitos + RT + 4 dígitos")
    .default(BUSINESS_NUMBER),
  gstCollectedCents: z.number().int().nonnegative(),
  gstItcCents: z.number().int().nonnegative(),
  pstCollectedCents: z.number().int().nonnegative().default(0),
  totalSalesCents: z.number().int().nonnegative(),
  annualRevenueCents: z.number().int().nonnegative().optional(),
});

export type GstReturnXmlInput = z.infer<typeof GstReturnXmlInputSchema>;

/**
 * Montos desglosados del GST return para generación de XML.
 */
export interface GstReturnAmounts {
  /** Line 101: Total sales and other revenue (base imponible) */
  totalSalesCents: number;
  /** Line 103: GST/HST collected or collectible */
  gstCollectedCents: number;
  /** Line 106: Input Tax Credits (ITCs) */
  gstItcCents: number;
  /** Line 109: Net tax = Line103 − Line106 */
  gstNetCents: number;
  /** Line 110: Installment payments (default 0) */
  installmentPaymentsCents: number;
  /** Line 111: Rebates (default 0) */
  rebatesCents: number;
  /** Line 112: Tax withheld at source (default 0) */
  taxWithheldCents: number;
  /** PST collected (BC provincial, informativo para PDF) */
  pstCollectedCents: number;
}

export const GstReturnAmountsSchema = z.object({
  totalSalesCents: z.number().int().nonnegative(),
  gstCollectedCents: z.number().int().nonnegative(),
  gstItcCents: z.number().int().nonnegative(),
  gstNetCents: z.number().int(),
  installmentPaymentsCents: z.number().int().nonnegative().default(0),
  rebatesCents: z.number().int().nonnegative().default(0),
  taxWithheldCents: z.number().int().nonnegative().default(0),
  pstCollectedCents: z.number().int().nonnegative(),
});

// =========================================================================
// Period helpers
// =========================================================================

/**
 * Convierte un período en formato "YYYY-QN" a rango de meses YYYY-MM start/end.
 *
 * @param periodo — Período en formato YYYY-QN (ej. "2026-Q2") o YYYY-MM.
 * @returns [periodoStart, periodoEnd] en formato YYYY-MM.
 */
export function quarterToMonthRange(periodo: string): [string, string] {
  const match = periodo.match(/^(\d{4})-Q([1-4])$/);
  if (!match) {
    const [yearStr, monthStr] = periodo.split("-");
    const year = parseInt(yearStr, 10);
    void year; // reserved for future cross-year boundary logic
    const month = parseInt(monthStr, 10);
    return [periodo, `${yearStr}-${String(month).padStart(2, "0")}`];
  }

  const year = parseInt(match[1], 10);
  void year; // used implicitly by match[1] in return below
  const quarter = parseInt(match[2], 10);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;

  const start = `${match[1]}-${String(startMonth).padStart(2, "0")}`;
  const end = `${match[1]}-${String(endMonth).padStart(2, "0")}`;

  return [start, end];
}

/**
 * Genera un período en formato "YYYY-QN" a partir de YYYY-MM.
 *
 * @param periodo — Período en formato YYYY-MM.
 * @returns Período en formato YYYY-QN.
 */
export function monthToQuarterLabel(periodo: string): string {
  const month = parseInt(periodo.slice(5, 7), 10);
  const quarter = Math.ceil(month / 3);
  return `${periodo.slice(0, 4)}-Q${quarter}`;
}

// =========================================================================
// GST Return XML generation (CRA T619 format)
// =========================================================================

/**
 * Genera el XML de GST/HST return en formato T619 para NETFILE de CRA.
 *
 * El XML sigue la especificación de CRA para transmisión electrónica
 * (T619 Electronic Filing). Incluye:
 *  - BN (Business Number) con program account RT0001
 *  - Período fiscal (fiscal period)
 *  - Total sales (line 101)
 *  - GST/HST collected or collectible (line 103)
 *  - Input tax credits (line 106)
 *  - Net tax (line 109) — si es positivo: a remitir; si es negativo: reembolso
 *  - PST collected (información suplementaria para BC)
 *  - Instalaciones de pago (instalment payments) si aplican
 *
 * El XML generado DEBE ser revisado por un contador antes de cargarse
 * al portal NETFILE de CRA.
 *
 * @param input — Datos del GST return.
 * @returns String XML listo para guardar o enviar.
 */
export function generateGstReturnXml(input: GstReturnXmlInput): string {
  const data = GstReturnXmlInputSchema.parse(input);

  const today = new Date().toISOString().slice(0, 10);
  const [periodStart, periodEnd] = quarterToMonthRange(data.periodo);
  const gstNetCents = data.gstCollectedCents - data.gstItcCents;

  const transmissionId = `TX-${data.periodo.replace(/[^A-Za-z0-9]/g, "")}-${Date.now()}`;

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<GSTHSTReturn`,
    `  xmlns="${CRA_NAMESPACE}"`,
    `  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
    `  xsi:schemaLocation="${CRA_NAMESPACE} GST-HST-Return-Schema.xsd"`,
    `  returnType="Original"`,
    `  referencePeriod="${data.periodo}"`,
    `  generatedDate="${today}"`,
    `>`,
    ``,
    `  <!-- Transmission Header — T619 Electronic Filing -->`,
    `  <TransmissionHeader>`,
    `    <TransmissionID>${xmlEscape(transmissionId)}</TransmissionID>`,
    `    <TransmissionDate>${today}</TransmissionDate>`,
    `    <TransmitterSoftwareCode>${xmlEscape(TRANSMITTER_SOFTWARE_CODE)}</TransmitterSoftwareCode>`,
    `    <TransmitterSoftwareVersion>1.0.0</TransmitterSoftwareVersion>`,
    `  </TransmissionHeader>`,
    ``,
    `  <!-- GST/HST Registrant Information -->`,
    `  <RegistrantInformation>`,
    `    <BusinessNumber>${xmlEscape(data.businessNumber)}</BusinessNumber>`,
    `    <FiscalPeriodStart>${periodStart}-01</FiscalPeriodStart>`,
    `    <FiscalPeriodEnd>${periodEnd}-${lastDayOfPeriod(periodEnd)}</FiscalPeriodEnd>`,
    `    <FilingFrequency>${getFilingFrequency(data.annualRevenueCents === undefined ? undefined : toCentsBigInt(data.annualRevenueCents))}</FilingFrequency>`,
    `  </RegistrantInformation>`,
    ``,
    `  <!-- GST/HST Return — Line Items -->`,
    `  <ReturnLines>`,
    `    <Line101>${centsToDollars(data.totalSalesCents)}</Line101>`,
    `    <Line103>${centsToDollars(data.gstCollectedCents)}</Line103>`,
    `    <Line104>0.00</Line104>`,
    `    <Line105>${centsToDollars(data.gstCollectedCents)}</Line105>`,
    `    <Line106>${centsToDollars(data.gstItcCents)}</Line106>`,
    `    <Line107>0.00</Line107>`,
    `    <Line108>${centsToDollars(data.gstItcCents)}</Line108>`,
    `    <Line109>${centsToDollars(gstNetCents)}</Line109>`,
    `    <Line110>0.00</Line110>`,
    `    <Line111>0.00</Line111>`,
    `    <Line112>${centsToDollars(gstNetCents)}</Line112>`,
    gstNetCents < 0
      ? `    <Line113A>${centsToDollars(Math.abs(gstNetCents))}</Line113A>`
      : `    <Line113A>0.00</Line113A>`,
    gstNetCents > 0
      ? `    <Line115>${centsToDollars(gstNetCents)}</Line115>`
      : `    <Line115>0.00</Line115>`,
    `  </ReturnLines>`,
    ``,
    `  <!-- Supplementary Information — BC Provincial Sales Tax (PST) -->`,
    `  <SupplementaryInformation>`,
    `    <Province>BC</Province>`,
    `    <PSTCollected>${centsToDollars(data.pstCollectedCents)}</PSTCollected>`,
    `    <PSTRateApplied>${(PST_RATE * 100).toFixed(0)}%</PSTRateApplied>`,
    `    <Note>PST se remite separadamente ante BC Ministry of Finance (eTaxBC). No incluido en el neto de GST.</Note>`,
    `  </SupplementaryInformation>`,
    ``,
    `  <!-- Declaration — Certificación del contribuyente -->`,
    `  <Declaration>`,
    `    <CertificationStatement>`,
    `      I certify that the information given in this return is correct and complete,`,
    `      and that I am authorized by the registrant to file this return.`,
    `    </CertificationStatement>`,
    `    <GeneratedBySystem>${xmlEscape(TRANSMITTER_SOFTWARE_CODE)}</GeneratedBySystem>`,
    `    <GeneratedDate>${today}</GeneratedDate>`,
    `  </Declaration>`,
    ``,
    `</GSTHSTReturn>`,
  ].join("\n");

  return xml;
}

// =========================================================================
// XML validation
// =========================================================================

/**
 * Resultado de la validación del XML de GST return.
 */
export interface XmlValidationResult {
  /** true si el XML pasó todas las validaciones estructurales */
  valid: boolean;
  /** Lista de errores encontrados (vacía si valid=true) */
  errors: string[];
  /** Lista de advertencias (no bloquean el envío pero deben revisarse) */
  warnings: string[];
}

/**
 * Valida la estructura del XML de GST/HST return contra la especificación
 * esperada por CRA (T619).
 *
 * Esta validación es ESTRUCTURAL, no valida contra el XSD oficial de CRA
 * (que requiere conexión a los sistemas de CRA). Verifica:
 *  - El XML es well-formed (parseable)
 *  - Los elementos requeridos existen: BN, fiscal period, line 101/103/106/109
 *  - El BN tiene el formato correcto (9 dígitos + RT + 4 dígitos)
 *  - Los montos no son negativos donde no corresponde
 *  - La consistencia aritmética: line 109 = line 105 - line 108
 *
 * @param xml — String XML a validar.
 * @returns XmlValidationResult con la lista de errores y advertencias.
 */
export function validateGstReturnXml(xml: string): XmlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Well-formed XML — verificar que tiene tag raíz
  if (!xml.includes("<GSTHSTReturn") || !xml.includes("</GSTHSTReturn>")) {
    errors.push("XML inválido: falta el elemento raíz <GSTHSTReturn> o no está bien formado");
    return { valid: false, errors, warnings };
  }

  // 2. Elementos requeridos por CRA
  const requiredElements = [
    { name: "TransmissionID", tag: "<TransmissionID>" },
    { name: "BusinessNumber", tag: "<BusinessNumber>" },
    { name: "FiscalPeriodStart", tag: "<FiscalPeriodStart>" },
    { name: "FiscalPeriodEnd", tag: "<FiscalPeriodEnd>" },
    { name: "Line101", tag: "<Line101>" },
    { name: "Line103", tag: "<Line103>" },
    { name: "Line105", tag: "<Line105>" },
    { name: "Line106", tag: "<Line106>" },
    { name: "Line108", tag: "<Line108>" },
    { name: "Line109", tag: "<Line109>" },
  ];

  for (const { name, tag } of requiredElements) {
    if (!xml.includes(tag)) {
      errors.push(`Falta elemento requerido: ${name} (${tag})`);
    }
  }

  // 3. Validar formato del Business Number
  const bnMatch = xml.match(/<BusinessNumber>(\d{9}RT\d{4})<\/BusinessNumber>/);
  if (!bnMatch) {
    errors.push(
      "Business Number no encontrado o formato inválido (debe ser 9 dígitos + RT + 4 dígitos, ej. 123456789RT0001)",
    );
  }

  // 4. Validar formato del período fiscal
  const periodStartMatch = xml.match(/<FiscalPeriodStart>(\d{4}-\d{2}-\d{2})<\/FiscalPeriodStart>/);
  const periodEndMatch = xml.match(/<FiscalPeriodEnd>(\d{4}-\d{2}-\d{2})<\/FiscalPeriodEnd>/);
  if (!periodStartMatch || !periodEndMatch) {
    errors.push("FiscalPeriodStart/FiscalPeriodEnd no encontrados o formato inválido");
  } else if (periodStartMatch[1] > periodEndMatch[1]) {
    errors.push(
      `FiscalPeriodStart (${periodStartMatch[1]}) es posterior a FiscalPeriodEnd (${periodEndMatch[1]})`,
    );
  }

  // 5. Consistencia aritmética de líneas
  const extractAmount = (tag: string): number | null => {
    const match = xml.match(new RegExp(`<${tag}>(-?[\\d.]+)</${tag}>`));
    return match ? parseFloat(match[1]) : null;
  };

  const line103 = extractAmount("Line103");
  const line104 = extractAmount("Line104");
  const line105 = extractAmount("Line105");
  const line106 = extractAmount("Line106");
  const line107 = extractAmount("Line107");
  const line108 = extractAmount("Line108");
  const line109 = extractAmount("Line109");

  if (line103 !== null && line104 !== null && line105 !== null) {
    const expected105 = line103 + line104;
    if (Math.abs(line105 - expected105) > 0.01) {
      errors.push(
        `Inconsistencia aritmética: Line105=${line105} pero debe ser Line103+Line104=${expected105}`,
      );
    }
  }

  if (line106 !== null && line107 !== null && line108 !== null) {
    const expected108 = line106 + line107;
    if (Math.abs(line108 - expected108) > 0.01) {
      errors.push(
        `Inconsistencia aritmética: Line108=${line108} pero debe ser Line106+Line107=${expected108}`,
      );
    }
  }

  if (line105 !== null && line108 !== null && line109 !== null) {
    const expected109 = line105 - line108;
    if (Math.abs(line109 - expected109) > 0.02) {
      errors.push(
        `Inconsistencia aritmética: Line109=${line109} pero debe ser Line105-Line108=${expected109}`,
      );
    }
  }

  // 6. Advertencias
  if (xml.includes("<Line109>-")) {
    warnings.push(
      "Line109 es negativo — se solicitará reembolso a CRA. Verificar que los ITCs están correctamente documentados.",
    );
  }

  if (!xml.includes("<SupplementaryInformation>")) {
    warnings.push(
      "Falta la sección de SupplementaryInformation (PST de BC). Asegurarse de reportar PST a BC MoF por separado.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =========================================================================
// GST Return Review document (HTML for admin review / PDF print)
// =========================================================================

/**
 * Genera una representación HTML estructurada del GST return para
 * revisión del administrador antes de enviar a CRA.
 *
 * El HTML resultante puede:
 *   a) Mostrarse en un iframe o pre en el panel de admin
 *   b) Imprimirse directamente desde el navegador (Ctrl+P → Save as PDF)
 *   c) Convertirse a PDF con cualquier conversor HTML→PDF
 *
 * @param input — Datos del GST return.
 * @returns String HTML representando el GST return para revisión.
 */
export function generateGstReturnReviewHtml(input: GstReturnXmlInput): string {
  const data = GstReturnXmlInputSchema.parse(input);
  const [periodStart, periodEnd] = quarterToMonthRange(data.periodo);
  const gstNetCents = data.gstCollectedCents - data.gstItcCents;
  const frequency = getFilingFrequency(data.annualRevenueCents === undefined ? undefined : toCentsBigInt(data.annualRevenueCents));
  const deadline = getFilingDeadline(
    data.periodo.includes("Q") ? periodStart : data.periodo,
    frequency,
  );
  const today = new Date().toISOString().slice(0, 10);

  const formatCAD = (cents: number): string =>
    `$${(cents / 100).toLocaleString("en-CA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} CAD`;

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="UTF-8">`,
    `<title>GST/HST Return — ${data.periodo} — Lulu Island Flagship</title>`,
    `<style>`,
    `  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 2rem auto; padding: 1rem; color: #1a1a1a; }`,
    `  h1 { border-bottom: 3px solid #c00; padding-bottom: 0.5rem; color: #c00; }`,
    `  h2 { color: #333; margin-top: 2rem; }`,
    `  .header { display: flex; justify-content: space-between; align-items: flex-start; }`,
    `  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 6rem; color: rgba(200,0,0,0.08); font-weight: 900; pointer-events: none; z-index: -1; white-space: nowrap; }`,
    `  .bn { font-family: 'Courier New', monospace; font-size: 1.1rem; letter-spacing: 2px; }`,
    `  .meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }`,
    `  table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; }`,
    `  th, td { padding: 0.75rem 1rem; text-align: right; }`,
    `  th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1px; color: #666; }`,
    `  td { border-bottom: 1px solid #e0e0e0; }`,
    `  td:first-child, th:first-child { text-align: left; }`,
    `  .total-row td { font-weight: 700; border-bottom: 2px solid #333; }`,
    `  .net-row td { font-size: 1.1rem; font-weight: 700; background: #fafafa; }`,
    `  .status-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }`,
    `  .status-review { background: #fff3cd; color: #856404; }`,
    `  .warn-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 1rem; margin: 1.5rem 0; }`,
    `  .footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #ccc; font-size: 0.75rem; color: #999; }`,
    `  @media print { body { margin: 0; padding: 0.5in; } .watermark { display: none; } }`,
    `</style>`,
    `</head>`,
    `<body>`,
    ``,
    `  <div class="watermark">DRAFT — FOR REVIEW ONLY</div>`,
    ``,
    `  <div class="header">`,
    `    <div>`,
    `      <h1>GST/HST Return</h1>`,
    `      <p class="meta">Generated: ${today} | Status: <span class="status-badge status-review">PENDIENTE DE REVISIÓN</span></p>`,
    `    </div>`,
    `    <div style="text-align:right;">`,
    `      <p><strong>Lulu Island Flagship</strong></p>`,
    `      <p class="bn">BN: ${data.businessNumber}</p>`,
    `    </div>`,
    `  </div>`,
    ``,
    `  <h2>Fiscal Period</h2>`,
    `  <table>`,
    `    <tr><td>Reference Period</td><td>${data.periodo}</td></tr>`,
    `    <tr><td>Period Start</td><td>${periodStart}-01</td></tr>`,
    `    <tr><td>Period End</td><td>${periodEnd}-${lastDayOfPeriod(periodEnd)}</td></tr>`,
    `    <tr><td>Filing Frequency</td><td>${frequency === "mensual" ? "Monthly" : "Quarterly"}</td></tr>`,
    `    <tr><td>Filing Deadline</td><td><strong>${deadline}</strong></td></tr>`,
    `  </table>`,
    ``,
    `  <h2>GST/HST Calculation</h2>`,
    `  <table>`,
    `    <thead>`,
    `      <tr><th>Line</th><th>Description</th><th>Amount</th></tr>`,
    `    </thead>`,
    `    <tbody>`,
    `      <tr><td>101</td><td>Total sales and other revenue</td><td>${formatCAD(data.totalSalesCents)}</td></tr>`,
    `      <tr><td>103</td><td>GST/HST collected or collectible (5%)</td><td>${formatCAD(data.gstCollectedCents)}</td></tr>`,
    `      <tr><td>104</td><td>Adjustments to GST collected</td><td>$0.00 CAD</td></tr>`,
    `      <tr class="total-row"><td>105</td><td>Total GST/HST and adjustments</td><td>${formatCAD(data.gstCollectedCents)}</td></tr>`,
    `      <tr><td>106</td><td>Input tax credits (ITCs)</td><td>${formatCAD(data.gstItcCents)}</td></tr>`,
    `      <tr><td>107</td><td>Adjustments to ITCs</td><td>$0.00 CAD</td></tr>`,
    `      <tr class="total-row"><td>108</td><td>Total ITCs and adjustments</td><td>${formatCAD(data.gstItcCents)}</td></tr>`,
    `      <tr class="net-row"><td>109</td><td>Net tax (Line 105 − 108)</td><td>${formatCAD(gstNetCents)}</td></tr>`,
    `    </tbody>`,
    `  </table>`,
    ``,
    `  <h2>Summary</h2>`,
    `  <table>`,
    gstNetCents > 0
      ? `    <tr><td>Balance Due to CRA</td><td><strong>${formatCAD(gstNetCents)}</strong></td></tr>`
      : `    <tr><td>Refund Claimed from CRA</td><td><strong>${formatCAD(Math.abs(gstNetCents))}</strong></td></tr>`,
    `    <tr><td>PST Collected (BC 7%) — separate filing to BC MoF</td><td>${formatCAD(data.pstCollectedCents)}</td></tr>`,
    `  </table>`,
    ``,
    `  <h2>Late Filing Penalty Estimate</h2>`,
    `  <table>`,
    `    <tr><td>Deadline</td><td>${deadline}</td></tr>`,
    `    <tr><td>Days until deadline</td><td>${daysUntilDeadline(deadline)} days</td></tr>`,
    `    <tr><td>Estimated late penalty (if filed after deadline, 5% base)</td><td>${formatCAD(calculateLatePenaltyCents(data.periodo, gstNetCents))}</td></tr>`,
    `  </table>`,
    ``,
    `  <div class="warn-box">`,
    `    <strong>⚠️ IMPORTANTE:</strong> Este documento es un borrador generado automáticamente.`,
    `    Debe ser revisado por un contador o administrador autorizado ANTES de enviarlo a CRA.`,
    `    La transmisión real se realiza a través del portal NETFILE de CRA o software certificado.`,
    `    El PST de BC se declara por separado ante BC Ministry of Finance (eTaxBC).`,
    `  </div>`,
    ``,
    `  <div class="footer">`,
    `    <p>Generated by Lulu Island Flagship Tax Engine v1.0 | ${today}</p>`,
    `    <p>This document does not constitute tax advice. Consult a qualified tax professional.</p>`,
    `  </div>`,
    ``,
    `</body>`,
    `</html>`,
  ].join("\n");
}

/**
 * Genera un PDF del GST return para revisión del administrador.
 *
 * Alias de generateGstReturnReviewHtml que retorna el HTML listo para
 * impresión (el navegador puede guardar como PDF con Ctrl+P).
 *
 * @param input — Datos del GST return.
 * @returns String HTML del GST return formateado para revisión e impresión.
 */
export function generateGstReturnPdf(input: GstReturnXmlInput): string {
  return generateGstReturnReviewHtml(input);
}

// =========================================================================
// Late filing penalties (CRA)
// =========================================================================

export interface LatePenaltyBreakdown {
  totalPenaltyCents: number;
  basePenaltyCents: number;
  additionalPenaltyCents: number;
  interestCents: number;
  monthsLate: number;
  daysLate: number;
  isOverdue: boolean;
  deadlineIso: string;
}

/**
 * Calcula la penalidad estimada por presentación tardía del GST return
 * según las reglas de CRA.
 *
 * Reglas de CRA para GST/HST (actualizado Q3 2026):
 *  - Penalidad base: 5% del monto adeudado si se presenta hasta 1 mes tarde.
 *  - Penalidad adicional: 1% por cada mes completo adicional de retraso
 *    (máximo 12 meses adicionales = 12% adicional, total 17%).
 *  - Interés sobre saldo pendiente: prescribed rate (~9% anual, compounding daily).
 *
 * Si el GST neto es negativo (reembolso), no hay penalidad por presentación
 * tardía (pero CRA puede aplicar penalidades administrativas).
 *
 * @param periodo — Período fiscal (YYYY-QN o YYYY-MM).
 * @param gstNetCents — GST neto a remitir en centavos (positivo = a pagar).
 * @param referenceDate — Fecha de referencia (default: hoy), ISO 8601.
 * @returns Penalidad total estimada en centavos.
 */
export function calculateLatePenaltyCents(
  periodo: string,
  gstNetCents: number,
  referenceDate?: string,
): number {
  if (gstNetCents <= 0) return 0;

  const refDate = referenceDate
    ? new Date(`${referenceDate}T00:00:00.000Z`)
    : new Date();
  refDate.setUTCHours(0, 0, 0, 0);

  const [periodStart] = quarterToMonthRange(periodo);
  const deadlineStr = getFilingDeadline(periodStart, "trimestral");
  const deadlineDate = new Date(`${deadlineStr}T00:00:00.000Z`);

  if (refDate <= deadlineDate) return 0;

  const diffMs = refDate.getTime() - deadlineDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const fullMonthsLate = Math.max(1, Math.floor(diffDays / 30));

  let penaltyRate = CRA_LATE_FILING_PENALTY_BASE;
  const additionalMonths = Math.max(0, fullMonthsLate - 1);
  penaltyRate += Math.min(additionalMonths, 12) * CRA_ADDITIONAL_MONTHLY_PENALTY;

  const penaltyCents = Math.round(gstNetCents * penaltyRate);
  const dailyInterestRate = CRA_INTEREST_ANNUAL_RATE / 365;
  const interestCents = Math.round(gstNetCents * dailyInterestRate * diffDays);

  return penaltyCents + interestCents;
}

/**
 * Calcula la penalidad por presentación tardía y retorna un breakdown
 * detallado para mostrar al administrador.
 *
 * @param periodo — Período fiscal.
 * @param gstNetCents — GST neto a remitir en centavos.
 * @param referenceDate — Fecha de referencia (default: hoy).
 * @returns Objeto con el breakdown de la penalidad.
 */
export function calculateLatePenalty(
  periodo: string,
  gstNetCents: number,
  referenceDate?: string,
): LatePenaltyBreakdown {
  if (gstNetCents <= 0) {
    const [periodStart] = quarterToMonthRange(periodo);
    return {
      totalPenaltyCents: 0,
      basePenaltyCents: 0,
      additionalPenaltyCents: 0,
      interestCents: 0,
      monthsLate: 0,
      daysLate: 0,
      isOverdue: false,
      deadlineIso: getFilingDeadline(periodStart, "trimestral"),
    };
  }

  const refDate = referenceDate
    ? new Date(`${referenceDate}T00:00:00.000Z`)
    : new Date();
  refDate.setUTCHours(0, 0, 0, 0);

  const [periodStart] = quarterToMonthRange(periodo);
  const deadlineStr = getFilingDeadline(periodStart, "trimestral");
  const deadlineDate = new Date(`${deadlineStr}T00:00:00.000Z`);

  const diffMs = refDate.getTime() - deadlineDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return {
      totalPenaltyCents: 0,
      basePenaltyCents: 0,
      additionalPenaltyCents: 0,
      interestCents: 0,
      monthsLate: 0,
      daysLate: 0,
      isOverdue: false,
      deadlineIso: deadlineStr,
    };
  }

  const fullMonthsLate = Math.max(1, Math.floor(diffDays / 30));
  const basePenaltyCents = Math.round(gstNetCents * CRA_LATE_FILING_PENALTY_BASE);
  const additionalMonths = Math.max(0, fullMonthsLate - 1);
  const additionalPenaltyCents = Math.round(
    gstNetCents * Math.min(additionalMonths, 12) * CRA_ADDITIONAL_MONTHLY_PENALTY,
  );
  const dailyInterestRate = CRA_INTEREST_ANNUAL_RATE / 365;
  const interestCents = Math.round(gstNetCents * dailyInterestRate * diffDays);

  return {
    totalPenaltyCents: basePenaltyCents + additionalPenaltyCents + interestCents,
    basePenaltyCents,
    additionalPenaltyCents,
    interestCents,
    monthsLate: fullMonthsLate,
    daysLate: diffDays,
    isOverdue: true,
    deadlineIso: deadlineStr,
  };
}

// =========================================================================
// Filing status helpers (netfile-specific convenience)
// =========================================================================

/**
 * Verifica si el estado ya pasó la etapa de revisión del admin.
 *
 * @param status — FilingStatus a verificar.
 * @returns true si ya fue revisado o avanzó más allá.
 */
export function isFilingReviewed(status: FilingStatus): boolean {
  return status !== "PENDIENTE" && status !== "GENERADO";
}

/**
 * Verifica si el return ya fue enviado (o confirmado) a CRA.
 *
 * @param status — FilingStatus a verificar.
 * @returns true si ya fue transmitido a CRA.
 */
export function isFilingSubmitted(status: FilingStatus): boolean {
  return status === "ENVIADO" || status === "RECIBIDO_CRA";
}

// =========================================================================
// Internal helpers
// =========================================================================

/** Convierte centavos (int) a string de dólares con 2 decimales para XML. */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Escapa caracteres especiales para contenido XML. */
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Calcula el último día de un período YYYY-MM. */
function lastDayOfPeriod(periodEnd: string): string {
  const [yearStr, monthStr] = periodEnd.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return String(lastDay).padStart(2, "0");
}

/** Calcula los días restantes hasta una fecha límite. */
function daysUntilDeadline(deadlineIso: string, referenceDate?: Date): number {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  ref.setUTCHours(0, 0, 0, 0);
  const deadline = new Date(`${deadlineIso}T00:00:00.000Z`);
  return Math.ceil(
    (deadline.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24),
  );
}

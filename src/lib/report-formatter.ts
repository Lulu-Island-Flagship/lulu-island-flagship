/**
 * v8.3 Capa 8 — Report Formatter.
 *
 * Formateo de estados financieros para distintos canales de salida:
 *   - Markdown: para consola de administrador, logs, mensajes internos.
 *   - JSON: para consumo por API, dashboards, exportación programática.
 *
 * Jerarquía de subtotales en P&L (de arriba hacia abajo):
 *   Ingresos Brutos → Ingresos Netos → Margen Bruto → EBITDA → Net Income
 *
 * Todas las funciones son puras: reciben estructuras tipadas de
 * financial-reports.ts y devuelven strings u objetos serializables.
 */

import type {
  TrialBalance,
  ProfitAndLoss,
  BalanceSheet,
  CashFlow,
  PnLByDimension,
} from "@/lib/financial-reports";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formatea centavos como CAD con 2 decimales. */
function formatCad(cents: number): string {
  const abs = Math.abs(cents);
  const dollars = (abs / 100).toFixed(2);
  return cents < 0 ? `-$${dollars}` : `$${dollars}`;
}

/** Formatea una fracción 0-1 como porcentaje con 1 decimal. */
function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Indentación para Markdown: 2 espacios por nivel. */
function indentMd(level: number): string {
  return "  ".repeat(level);
}

/** Ancho de la columna de etiquetas (para alinear montos a la derecha). */
const LABEL_WIDTH = 42;

/** Rellena una etiqueta al ancho fijo para alineación tipo consola. */
function padLabel(label: string, indent: number): string {
  const prefix = indentMd(indent);
  const full = prefix + label;
  return full.padEnd(LABEL_WIDTH, " ");
}

// ---------------------------------------------------------------------------
// P&L: Markdown Formatter
// ---------------------------------------------------------------------------

/**
 * Formatea un Profit & Loss como string Markdown legible para consola/admin.
 *
 * Jerarquía visual con subtotales anidados:
 * ```
 * Operating Revenue                          $12,500.00
 *   Regular Cleaning Revenue                  $5,200.00
 *   Deep Cleaning Revenue                     $4,100.00
 *   ...
 * Less: Discounts & Returns                  -$250.00
 * Net Revenue                                $12,250.00
 * ...
 * Gross Margin                                $4,800.00 (39.2%)
 * ...
 * EBITDA                                      $2,150.00 (17.6%)
 * ...
 * Net Income                                  $1,340.00 (10.9%)
 * ```
 *
 * @param pnl Resultado de generatePnL().
 * @returns String Markdown multilínea listo para mostrar en consola o MD.
 */
export function formatPnLAsMarkdown(pnl: ProfitAndLoss): string {
  const lines: string[] = [];

  lines.push(`## Profit & Loss — ${pnl.period}`);
  lines.push("");
  lines.push("```");
  lines.push(`${"Account".padEnd(LABEL_WIDTH)} Amount`);
  lines.push(`${"-".repeat(LABEL_WIDTH)} ------`);

  for (const item of pnl.lines) {
    const label = padLabel(item.label, item.indent);
    const amount = item.amountCents === 0 && !item.isSubtotal
      ? "-"
      : formatCad(item.amountCents);
    lines.push(`${label} ${amount}`);
  }

  lines.push("```");
  lines.push("");

  // --- Summary footer ---
  lines.push("### Key Metrics");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| ------ | ----- |`);
  lines.push(`| Gross Revenue | ${formatCad(pnl.grossRevenueCents)} |`);
  lines.push(`| Net Revenue | ${formatCad(pnl.netRevenueCents)} |`);
  lines.push(`| Gross Margin | ${formatCad(pnl.grossMarginCents)} (${formatPercent(pnl.grossMarginPercent)}) |`);
  lines.push(`| EBITDA | ${formatCad(pnl.ebitdaCents)} (${formatPercent(pnl.ebitdaPercent)}) |`);
  lines.push(`| Net Income | ${formatCad(pnl.netIncomeCents)} (${formatPercent(pnl.netMarginPercent)}) |`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// P&L: JSON Formatter (API-friendly)
// ---------------------------------------------------------------------------

/** Formato JSON plano para API: una línea por cuenta con subtotales calculados. */
export interface PnLJsonLine {
  label: string;
  amountCents: number;
  amountFormatted: string;
  indent: number;
  isSubtotal: boolean;
  accountCode?: string;
}

/** Respuesta JSON completa del P&L para consumo por API. */
export interface PnLJsonResponse {
  period: string;
  lines: PnLJsonLine[];
  summary: {
    grossRevenueCents: number;
    grossRevenueFormatted: string;
    netRevenueCents: number;
    netRevenueFormatted: string;
    grossMarginCents: number;
    grossMarginFormatted: string;
    grossMarginPercent: number;
    ebitdaCents: number;
    ebitdaFormatted: string;
    ebitdaPercent: number;
    netIncomeCents: number;
    netIncomeFormatted: string;
    netMarginPercent: number;
  };
}

/**
 * Formatea un P&L como objeto JSON para respuestas de API.
 *
 * Incluye líneas detalladas y un bloque `summary` con los subtotales clave
 * ya formateados como strings para consumo directo en frontends.
 *
 * @param pnl Resultado de generatePnL().
 * @returns Objeto serializable para JSON response.
 */
export function formatPnLAsJson(pnl: ProfitAndLoss): PnLJsonResponse {
  const lines: PnLJsonLine[] = pnl.lines.map((item) => ({
    label: item.label,
    amountCents: item.amountCents,
    amountFormatted: formatCad(item.amountCents),
    indent: item.indent,
    isSubtotal: item.isSubtotal,
    accountCode: item.accountCode,
  }));

  return {
    period: pnl.period,
    lines,
    summary: {
      grossRevenueCents: pnl.grossRevenueCents,
      grossRevenueFormatted: formatCad(pnl.grossRevenueCents),
      netRevenueCents: pnl.netRevenueCents,
      netRevenueFormatted: formatCad(pnl.netRevenueCents),
      grossMarginCents: pnl.grossMarginCents,
      grossMarginFormatted: formatCad(pnl.grossMarginCents),
      grossMarginPercent: pnl.grossMarginPercent,
      ebitdaCents: pnl.ebitdaCents,
      ebitdaFormatted: formatCad(pnl.ebitdaCents),
      ebitdaPercent: pnl.ebitdaPercent,
      netIncomeCents: pnl.netIncomeCents,
      netIncomeFormatted: formatCad(pnl.netIncomeCents),
      netMarginPercent: pnl.netMarginPercent,
    },
  };
}

// ---------------------------------------------------------------------------
// Trial Balance: Markdown & JSON
// ---------------------------------------------------------------------------

/**
 * Formatea un Trial Balance como string Markdown.
 * Incluye indicador de balance (✓ si cuadra, ⚠ con discrepancia si no).
 *
 * @param tb Resultado de generateTrialBalance().
 */
export function formatTrialBalanceAsMarkdown(tb: TrialBalance): string {
  const lines: string[] = [];

  const status = tb.isBalanced
    ? "✓ BALANCED"
    : `⚠ UNBALANCED (discrepancy: ${formatCad(tb.discrepancyCents)})`;

  lines.push(`## Trial Balance — ${tb.period}  ${status}`);
  lines.push("");
  lines.push("```");
  lines.push(`${"Account".padEnd(LABEL_WIDTH)} Debit        Credit`);
  lines.push(`${"-".repeat(LABEL_WIDTH)} -----        ------`);

  for (const line of tb.lines) {
    const accountLabel = `${line.accountCode} ${line.accountName}`;
    const label = accountLabel.padEnd(LABEL_WIDTH);
    const debit = line.debitBalanceCents > 0 ? formatCad(line.debitBalanceCents) : "-";
    const credit = line.creditBalanceCents > 0 ? formatCad(line.creditBalanceCents) : "-";
    lines.push(`${label} ${debit.padStart(12)} ${credit.padStart(12)}`);
  }

  lines.push(`${"-".repeat(LABEL_WIDTH)} -----        ------`);
  const totalLabel = "TOTAL".padEnd(LABEL_WIDTH);
  lines.push(
    `${totalLabel} ${formatCad(tb.totalDebitsCents).padStart(12)} ${formatCad(tb.totalCreditsCents).padStart(12)}`
  );
  lines.push("```");

  return lines.join("\n");
}

/** Respuesta JSON del Trial Balance para API. */
export interface TrialBalanceJsonResponse {
  period: string;
  isBalanced: boolean;
  discrepancyCents: number;
  totalDebitsCents: number;
  totalCreditsCents: number;
  lines: {
    accountCode: string;
    accountName: string;
    accountType: string;
    debitBalanceCents: number;
    creditBalanceCents: number;
    debitFormatted: string;
    creditFormatted: string;
  }[];
}

/**
 * Formatea un Trial Balance como objeto JSON.
 */
export function formatTrialBalanceAsJson(tb: TrialBalance): TrialBalanceJsonResponse {
  return {
    period: tb.period,
    isBalanced: tb.isBalanced,
    discrepancyCents: tb.discrepancyCents,
    totalDebitsCents: tb.totalDebitsCents,
    totalCreditsCents: tb.totalCreditsCents,
    lines: tb.lines.map((line) => ({
      accountCode: line.accountCode,
      accountName: line.accountName,
      accountType: line.accountType,
      debitBalanceCents: line.debitBalanceCents,
      creditBalanceCents: line.creditBalanceCents,
      debitFormatted: formatCad(line.debitBalanceCents),
      creditFormatted: formatCad(line.creditBalanceCents),
    })),
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet: Markdown & JSON
// ---------------------------------------------------------------------------

/**
 * Formatea un Balance Sheet como string Markdown.
 *
 * @param bs Resultado de generateBalanceSheet().
 */
export function formatBalanceSheetAsMarkdown(bs: BalanceSheet): string {
  const lines: string[] = [];
  const status = bs.isBalanced
    ? "✓ BALANCED (A = L + E)"
    : `⚠ UNBALANCED — discrepancy: ${formatCad(bs.discrepancyCents)}`;

  lines.push(`## Balance Sheet — as of ${bs.asOfDate}  ${status}`);
  lines.push("");

  // Assets
  lines.push("### ASSETS");
  for (const section of [bs.currentAssets, bs.fixedAssets]) {
    lines.push(`**${section.label}**`);
    for (const item of section.lines) {
      const label = padLabel(item.label, item.indent);
      const amount = item.amountCents === 0 ? "-" : formatCad(item.amountCents);
      lines.push(`  ${label} ${amount}`);
    }
  }
  lines.push(`**Total Assets:** ${formatCad(bs.totalAssetsCents)}`);
  lines.push("");

  // Liabilities
  lines.push("### LIABILITIES");
  for (const section of [bs.currentLiabilities, bs.longTermLiabilities]) {
    lines.push(`**${section.label}**`);
    for (const item of section.lines) {
      const label = padLabel(item.label, item.indent);
      const amount = item.amountCents === 0 ? "-" : formatCad(item.amountCents);
      lines.push(`  ${label} ${amount}`);
    }
  }
  lines.push(`**Total Liabilities:** ${formatCad(bs.totalLiabilitiesCents)}`);
  lines.push("");

  // Equity
  lines.push("### EQUITY");
  for (const item of bs.equity.lines) {
    const label = padLabel(item.label, item.indent);
    const amount = item.amountCents === 0 ? "-" : formatCad(item.amountCents);
    lines.push(`  ${label} ${amount}`);
  }
  lines.push(`**Total Equity:** ${formatCad(bs.totalEquityCents)}`);
  lines.push("");
  lines.push(`**Total Liabilities + Equity:** ${formatCad(bs.totalLiabilitiesCents + bs.totalEquityCents)}`);

  return lines.join("\n");
}

/** Respuesta JSON del Balance Sheet para API. */
export interface BalanceSheetJsonResponse {
  asOfDate: string;
  isBalanced: boolean;
  totalAssetsCents: number;
  totalAssetsFormatted: string;
  totalLiabilitiesCents: number;
  totalLiabilitiesFormatted: string;
  totalEquityCents: number;
  totalEquityFormatted: string;
  sections: {
    label: string;
    type: "asset" | "liability" | "equity";
    totalCents: number;
    totalFormatted: string;
    items: {
      label: string;
      amountCents: number;
      amountFormatted: string;
    }[];
  }[];
}

/**
 * Formatea un Balance Sheet como objeto JSON.
 */
export function formatBalanceSheetAsJson(bs: BalanceSheet): BalanceSheetJsonResponse {
  function sectionItems(
    section: typeof bs.currentAssets
  ): BalanceSheetJsonResponse["sections"][number]["items"] {
    return section.lines.map((item) => ({
      label: item.label,
      amountCents: item.amountCents,
      amountFormatted: formatCad(item.amountCents),
    }));
  }

  return {
    asOfDate: bs.asOfDate,
    isBalanced: bs.isBalanced,
    totalAssetsCents: bs.totalAssetsCents,
    totalAssetsFormatted: formatCad(bs.totalAssetsCents),
    totalLiabilitiesCents: bs.totalLiabilitiesCents,
    totalLiabilitiesFormatted: formatCad(bs.totalLiabilitiesCents),
    totalEquityCents: bs.totalEquityCents,
    totalEquityFormatted: formatCad(bs.totalEquityCents),
    sections: [
      {
        label: bs.currentAssets.label,
        type: "asset",
        totalCents: bs.currentAssets.totalCents,
        totalFormatted: formatCad(bs.currentAssets.totalCents),
        items: sectionItems(bs.currentAssets),
      },
      {
        label: bs.fixedAssets.label,
        type: "asset",
        totalCents: bs.fixedAssets.totalCents,
        totalFormatted: formatCad(bs.fixedAssets.totalCents),
        items: sectionItems(bs.fixedAssets),
      },
      {
        label: bs.currentLiabilities.label,
        type: "liability",
        totalCents: bs.currentLiabilities.totalCents,
        totalFormatted: formatCad(bs.currentLiabilities.totalCents),
        items: sectionItems(bs.currentLiabilities),
      },
      {
        label: bs.longTermLiabilities.label,
        type: "liability",
        totalCents: bs.longTermLiabilities.totalCents,
        totalFormatted: formatCad(bs.longTermLiabilities.totalCents),
        items: sectionItems(bs.longTermLiabilities),
      },
      {
        label: bs.equity.label,
        type: "equity",
        totalCents: bs.equity.totalCents,
        totalFormatted: formatCad(bs.equity.totalCents),
        items: sectionItems(bs.equity),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Cash Flow: Markdown & JSON
// ---------------------------------------------------------------------------

/**
 * Formatea un Cash Flow como string Markdown.
 *
 * @param cf Resultado de generateCashFlow().
 */
export function formatCashFlowAsMarkdown(cf: CashFlow): string {
  const lines: string[] = [];

  lines.push(`## Cash Flow — ${cf.periodStart} to ${cf.periodEnd}`);
  lines.push("");

  for (const section of [cf.operating, cf.investing, cf.financing]) {
    if (section.lines.length === 0) continue;
    lines.push(`### ${section.label}`);
    for (const item of section.lines) {
      const label = padLabel(item.label, item.indent);
      const amount = item.amountCents === 0 ? "-" : formatCad(item.amountCents);
      lines.push(`  ${label} ${amount}`);
    }
    lines.push("");
  }

  lines.push(`**Net Change in Cash:** ${formatCad(cf.netChangeInCashCents)}`);
  lines.push(`**Beginning Cash:** ${formatCad(cf.beginningCashCents)}`);
  lines.push(`**Ending Cash:** ${formatCad(cf.endingCashCents)}`);

  return lines.join("\n");
}

/** Respuesta JSON del Cash Flow para API. */
export interface CashFlowJsonResponse {
  periodStart: string;
  periodEnd: string;
  netChangeInCashCents: number;
  netChangeFormatted: string;
  beginningCashCents: number;
  beginningCashFormatted: string;
  endingCashCents: number;
  endingCashFormatted: string;
  sections: {
    label: string;
    type: "operating" | "investing" | "financing";
    netCashCents: number;
    netCashFormatted: string;
    items: {
      label: string;
      amountCents: number;
      amountFormatted: string;
    }[];
  }[];
}

/**
 * Formatea un Cash Flow como objeto JSON.
 */
export function formatCashFlowAsJson(cf: CashFlow): CashFlowJsonResponse {
  return {
    periodStart: cf.periodStart,
    periodEnd: cf.periodEnd,
    netChangeInCashCents: cf.netChangeInCashCents,
    netChangeFormatted: formatCad(cf.netChangeInCashCents),
    beginningCashCents: cf.beginningCashCents,
    beginningCashFormatted: formatCad(cf.beginningCashCents),
    endingCashCents: cf.endingCashCents,
    endingCashFormatted: formatCad(cf.endingCashCents),
    sections: [
      {
        label: cf.operating.label,
        type: "operating",
        netCashCents: cf.operating.netCashCents,
        netCashFormatted: formatCad(cf.operating.netCashCents),
        items: cf.operating.lines.map((item) => ({
          label: item.label,
          amountCents: item.amountCents,
          amountFormatted: formatCad(item.amountCents),
        })),
      },
      {
        label: cf.investing.label,
        type: "investing",
        netCashCents: cf.investing.netCashCents,
        netCashFormatted: formatCad(cf.investing.netCashCents),
        items: cf.investing.lines.map((item) => ({
          label: item.label,
          amountCents: item.amountCents,
          amountFormatted: formatCad(item.amountCents),
        })),
      },
      {
        label: cf.financing.label,
        type: "financing",
        netCashCents: cf.financing.netCashCents,
        netCashFormatted: formatCad(cf.financing.netCashCents),
        items: cf.financing.lines.map((item) => ({
          label: item.label,
          amountCents: item.amountCents,
          amountFormatted: formatCad(item.amountCents),
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// P&L Dimensional: Markdown & JSON
// ---------------------------------------------------------------------------

/**
 * Formatea un arreglo de P&L dimensional como tabla Markdown.
 *
 * @param data Resultado de generatePnLByZone/Team/ServiceType.
 * @param title Título descriptivo (e.g., "P&L by Zone").
 */
export function formatPnLByDimensionAsMarkdown(
  data: PnLByDimension[],
  title: string
): string {
  if (data.length === 0) {
    return `## ${title}\n\n_No data for this period._\n`;
  }

  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(
    `| Dimension | Orders | Revenue | Direct Costs | Gross Margin | Margin % |`
  );
  lines.push(
    `| --------- | ------ | ------- | ------------ | ------------ | -------- |`
  );

  for (const row of data) {
    const marginClass = row.grossMarginPercent < 0.15 ? "🔴" : row.grossMarginPercent < 0.25 ? "🟡" : "🟢";
    lines.push(
      `| ${row.dimensionValue} | ${row.orderCount} | ${formatCad(row.revenueCents)} | ${formatCad(row.directCostsCents)} | ${formatCad(row.grossMarginCents)} | ${marginClass} ${formatPercent(row.grossMarginPercent)} |`
    );
  }

  return lines.join("\n");
}

/**
 * Formatea un arreglo de P&L dimensional como objeto JSON.
 */
export function formatPnLByDimensionAsJson(
  data: PnLByDimension[]
): {
  dimensions: {
    dimensionValue: string;
    orderCount: number;
    revenueCents: number;
    revenueFormatted: string;
    directCostsCents: number;
    directCostsFormatted: string;
    grossMarginCents: number;
    grossMarginFormatted: string;
    grossMarginPercent: number;
    isLowMargin: boolean;
  }[];
} {
  return {
    dimensions: data.map((row) => ({
      dimensionValue: row.dimensionValue,
      orderCount: row.orderCount,
      revenueCents: row.revenueCents,
      revenueFormatted: formatCad(row.revenueCents),
      directCostsCents: row.directCostsCents,
      directCostsFormatted: formatCad(row.directCostsCents),
      grossMarginCents: row.grossMarginCents,
      grossMarginFormatted: formatCad(row.grossMarginCents),
      grossMarginPercent: row.grossMarginPercent,
      isLowMargin: row.grossMarginPercent < 0.15,
    })),
  };
}

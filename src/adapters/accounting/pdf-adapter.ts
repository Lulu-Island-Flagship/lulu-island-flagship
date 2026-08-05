/**
 * Capa 9 — PDF Financial Statements Adapter.
 *
 * Genera un documento HTML con CSS print-friendly que contiene los tres
 * estados financieros principales:
 *   1. Profit & Loss (Estado de Resultados)
 *   2. Balance Sheet (Balance General)
 *   3. Cash Flow (Flujo de Efectivo)
 *
 * El output es HTML listo para imprimir como PDF desde el navegador
 * (Cmd+P / Ctrl+P → Save as PDF) o desde un headless browser como Puppeteer.
 * No requiere librerías externas de PDF — el navegador es el renderer.
 *
 * Usa los reportes puros de `financial-reports.ts` como fuente de datos.
 *
 * Template: diseño limpio tipo "informe bancario" con:
 *   - Encabezado corporativo
 *   - Tipografía profesional (system-ui / Georgia para números)
 *   - @media print con @page margins para impresión impecable
 *   - Saltos de página entre estados financieros
 *
 * Listo para enviar al banco, contador, o CRA.
 *
 * Regla de oro: Solo export. Nunca lee de QBO/Xero.
 */

import type { FinancialLedgerEntry } from "@/lib/financial-reports";
import {
  generatePnL,
  generateBalanceSheet,
  generateCashFlow,
  type PnLLine,
  type ProfitAndLoss,
  type BalanceSheet,
  type CashFlow,
} from "@/lib/financial-reports";
import type {
  AccountingAdapter,
} from "@/lib/accounting-adapter";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Opciones de personalización para el adaptador PDF. */
export interface PdfAdapterOptions {
  /** Nombre legal de la empresa (default: "Lulu Island Flagship"). */
  companyName?: string;
  /** Símbolo de moneda (default: "CAD $"). */
  currencySymbol?: string;
  /** Saldo inicial de caja para el Cash Flow. Default: 0. */
  beginningCashCents?: number;
}

/** Valores por defecto de las opciones. */
const DEFAULTS: Required<PdfAdapterOptions> = {
  companyName: "Lulu Island Flagship",
  currencySymbol: "CAD $",
  beginningCashCents: 0,
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Calcula el último día del mes para un período YYYY-MM.
 *
 * @example "2026-02" → "2026-02-28" (o 29 en año bisiesto).
 */
function endOfMonth(periodo: string): string {
  const [y, m] = periodo.split("-");
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  // Día 0 del mes siguiente = último día del mes actual
  const lastDay = new Date(year, month, 0).getDate();
  return `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Convierte período YYYY-MM a fecha de inicio YYYY-MM-01.
 */
function startOfMonth(periodo: string): string {
  return `${periodo}-01`;
}

/**
 * Formatea un período YYYY-MM a nombre legible (ej. "August 2026").
 */
function formatPeriodLabel(periodo: string): string {
  const [y, m] = periodo.split("-");
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-CA", {
    month: "long",
    year: "numeric",
  });
}

/**
 * Formatea una fecha ISO a formato legible (ej. "August 4, 2026").
 */
function formatDateLabel(isoDate: string): string {
  const d = new Date(isoDate + "T12:00:00Z");
  return d.toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Convierte centavos a string con formato dólar.
 * Negativos llevan signo y paréntesis.
 */
function formatDollars(cents: number): string {
  const absValue = Math.abs(cents);
  const dollars = (absValue / 100).toFixed(2);
  if (cents < 0) return `(${dollars})`;
  return dollars;
}

/** Escapa caracteres HTML para prevenir XSS en el template. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renderiza una línea del P&L con indentación.
 * Las líneas de subtotal llevan énfasis visual (bold + línea superior).
 */
function renderPnLLine(line: PnLLine): string {
  const paddingLeft = line.indent * 24; // 24px por nivel de indentación
  const boldClass = line.isSubtotal ? ' class="subtotal"' : "";
  const amountClass = line.amountCents < 0 ? "negative" : "";
  const amountFormatted = formatDollars(line.amountCents);

  let html = `<tr${boldClass}>`;
  html += `<td style="padding-left:${paddingLeft}px">${escapeHtml(line.label)}</td>`;
  html += `<td class="amount ${amountClass}">${amountFormatted}</td>`;
  html += `</tr>\n`;

  // Renderizar hijos recursivamente si existen
  if (line.children && line.children.length > 0) {
    for (const child of line.children) {
      html += renderPnLLine(child);
    }
  }

  return html;
}

// ---------------------------------------------------------------------------
// Report sections
// ---------------------------------------------------------------------------

/**
 * Genera la sección HTML del P&L.
 */
function renderPnLSection(pnl: ProfitAndLoss, currencySymbol: string): string {
  let html = '<h2>Profit &amp; Loss Statement</h2>\n';
  html += '<table class="report-table">\n';
  html += "<thead><tr><th>Account</th><th class=\"amount\">Amount</th></tr></thead>\n";
  html += "<tbody>\n";

  for (const line of pnl.lines) {
    html += renderPnLLine(line);
  }

  html += "</tbody>\n</table>\n";

  // Key metrics summary
  html += '<div class="metrics-summary">\n';
  html += `<p><strong>Gross Margin:</strong> ${formatDollars(pnl.grossMarginCents)} ${currencySymbol} (${(pnl.grossMarginPercent * 100).toFixed(1)}%)</p>\n`;
  html += `<p><strong>EBITDA:</strong> ${formatDollars(pnl.ebitdaCents)} ${currencySymbol} (${(pnl.ebitdaPercent * 100).toFixed(1)}%)</p>\n`;
  html += `<p><strong>Net Income:</strong> ${formatDollars(pnl.netIncomeCents)} ${currencySymbol} (${(pnl.netMarginPercent * 100).toFixed(1)}% margin)</p>\n`;
  html += "</div>\n";

  return html;
}

/**
 * Genera la sección HTML del Balance Sheet.
 */
function renderBalanceSheetSection(
  bs: BalanceSheet,
  _currencySymbol: string
): string {
  let html = '<h2>Balance Sheet</h2>\n';
  html += `<p class="as-of">As of ${escapeHtml(formatDateLabel(bs.asOfDate))}</p>\n`;

  const sections = [
    { label: "ASSETS", data: [bs.currentAssets, bs.fixedAssets] },
    { label: "LIABILITIES", data: [bs.currentLiabilities, bs.longTermLiabilities] },
    { label: "EQUITY", data: [bs.equity] },
  ];

  for (const section of sections) {
    html += `<h3>${escapeHtml(section.label)}</h3>\n`;
    html += '<table class="report-table">\n';
    html += "<thead><tr><th>Account</th><th class=\"amount\">Amount</th></tr></thead>\n";
    html += "<tbody>\n";

    for (const sub of section.data) {
      html += `<tr class="section-header"><td colspan="2"><strong>${escapeHtml(sub.label)}</strong></td></tr>\n`;
      for (const line of sub.lines) {
        html += renderPnLLine(line);
      }
    }

    html += "</tbody>\n</table>\n";
  }

  // Balance check
  html += '<div class="metrics-summary">\n';
  html += `<p><strong>Total Assets:</strong> ${formatDollars(bs.totalAssetsCents)}</p>\n`;
  html += `<p><strong>Total Liabilities + Equity:</strong> ${formatDollars(bs.totalLiabilitiesCents + bs.totalEquityCents)}</p>\n`;
  if (!bs.isBalanced) {
    html += `<p class="warning">⚠ Balance Sheet does not balance. Discrepancy: ${formatDollars(bs.discrepancyCents)}</p>\n`;
  }
  html += "</div>\n";

  return html;
}

/**
 * Genera la sección HTML del Cash Flow.
 */
function renderCashFlowSection(
  cf: CashFlow,
  _currencySymbol: string
): string {
  let html = '<h2>Cash Flow Statement</h2>\n';
  html += `<p class="as-of">${escapeHtml(formatDateLabel(cf.periodStart))} — ${escapeHtml(formatDateLabel(cf.periodEnd))}</p>\n`;

  const sections = [cf.operating, cf.investing, cf.financing];

  for (const section of sections) {
    html += `<h3>${escapeHtml(section.label)}</h3>\n`;
    html += '<table class="report-table">\n';
    html += "<thead><tr><th>Item</th><th class=\"amount\">Amount</th></tr></thead>\n";
    html += "<tbody>\n";

    for (const line of section.lines) {
      html += renderPnLLine(line);
    }

    html += "</tbody>\n</table>\n";
  }

  html += '<div class="metrics-summary">\n';
  html += `<p><strong>Beginning Cash:</strong> ${formatDollars(cf.beginningCashCents)}</p>\n`;
  html += `<p><strong>Net Change in Cash:</strong> ${formatDollars(cf.netChangeInCashCents)}</p>\n`;
  html += `<p><strong>Ending Cash:</strong> ${formatDollars(cf.endingCashCents)}</p>\n`;
  html += "</div>\n";

  return html;
}

// ---------------------------------------------------------------------------
// Full HTML document
// ---------------------------------------------------------------------------

/**
 * Construye el documento HTML completo con CSS inline y print-friendly.
 */
function buildHtmlDocument(
  pnl: ProfitAndLoss,
  bs: BalanceSheet,
  cf: CashFlow,
  periodo: string,
  options: Required<PdfAdapterOptions>
): string {
  const periodLabel = formatPeriodLabel(periodo);
  const generatedAt = new Date().toISOString().slice(0, 10);
  const currency = options.currencySymbol;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Financial Statements — ${escapeHtml(periodLabel)}</title>
<style>
  /* ── Reset & Base ─────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #1a1a1a;
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 32px;
    background: #fff;
  }

  /* ── Header ───────────────────────────────────────── */
  .report-header {
    text-align: center;
    border-bottom: 3px double #1a1a1a;
    padding-bottom: 20px;
    margin-bottom: 32px;
  }
  .report-header .company-name {
    font-size: 18pt;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .report-header .report-title {
    font-size: 14pt;
    color: #444;
    margin-bottom: 2px;
  }
  .report-header .report-period {
    font-size: 12pt;
    color: #666;
  }

  /* ── Section titles ───────────────────────────────── */
  h2 {
    font-size: 14pt;
    font-weight: 700;
    color: #1a1a1a;
    border-bottom: 1px solid #ccc;
    padding-bottom: 6px;
    margin-top: 36px;
    margin-bottom: 12px;
    page-break-before: always;
  }
  h2:first-of-type { page-break-before: auto; }

  h3 {
    font-size: 11pt;
    font-weight: 600;
    color: #333;
    margin-top: 16px;
    margin-bottom: 6px;
  }

  .as-of {
    font-size: 10pt;
    color: #666;
    margin-bottom: 12px;
  }

  /* ── Tables ───────────────────────────────────────── */
  .report-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  .report-table thead th {
    text-align: left;
    font-size: 9pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #555;
    border-bottom: 2px solid #1a1a1a;
    padding: 6px 4px;
  }
  .report-table th.amount,
  .report-table td.amount {
    text-align: right;
    font-family: Georgia, "Times New Roman", serif;
    font-variant-numeric: tabular-nums;
  }
  .report-table td {
    padding: 4px;
    border-bottom: 1px solid #eee;
    font-size: 10.5pt;
  }
  .report-table .section-header td {
    padding-top: 10px;
    font-size: 10.5pt;
    border-bottom: 1px solid #ddd;
  }
  .report-table .subtotal td {
    font-weight: 700;
    border-top: 1px solid #1a1a1a;
  }
  .report-table .subtotal td:first-child {
    padding-left: 0;
  }
  .report-table .negative {
    color: #c0392b;
  }

  /* ── Summary box ──────────────────────────────────── */
  .metrics-summary {
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 12px 16px;
    margin-bottom: 16px;
    font-size: 10.5pt;
  }
  .metrics-summary p {
    margin-bottom: 2px;
  }
  .metrics-summary .warning {
    color: #c0392b;
    font-weight: 600;
  }

  /* ── Footer ───────────────────────────────────────── */
  .report-footer {
    margin-top: 48px;
    padding-top: 12px;
    border-top: 1px solid #ccc;
    font-size: 8.5pt;
    color: #999;
    text-align: center;
  }

  /* ── Print styles ─────────────────────────────────── */
  @media print {
    @page {
      size: letter;
      margin: 0.75in 0.75in 1in 0.75in;
    }
    body {
      padding: 0;
      max-width: none;
      font-size: 10pt;
    }
    .report-header {
      border-bottom: 2px double #000;
    }
    h2 {
      page-break-before: always;
    }
    h2:first-of-type {
      page-break-before: auto;
    }
    .metrics-summary {
      background: none;
      border: 1px solid #ccc;
    }
    .report-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
    }
  }

  @media screen {
    body {
      box-shadow: 0 0 20px rgba(0,0,0,0.05);
      min-height: 100vh;
    }
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════ -->
<!-- HEADER                                              -->
<!-- ═══════════════════════════════════════════════════ -->
<header class="report-header">
  <div class="company-name">${escapeHtml(options.companyName)}</div>
  <div class="report-title">Financial Statements</div>
  <div class="report-period">For the period ending ${escapeHtml(periodLabel)}</div>
</header>

<!-- ═══════════════════════════════════════════════════ -->
<!-- PROFIT & LOSS                                       -->
<!-- ═══════════════════════════════════════════════════ -->
${renderPnLSection(pnl, currency)}

<!-- ═══════════════════════════════════════════════════ -->
<!-- BALANCE SHEET                                       -->
<!-- ═══════════════════════════════════════════════════ -->
${renderBalanceSheetSection(bs, currency)}

<!-- ═══════════════════════════════════════════════════ -->
<!-- CASH FLOW                                           -->
<!-- ═══════════════════════════════════════════════════ -->
${renderCashFlowSection(cf, currency)}

<!-- ═══════════════════════════════════════════════════ -->
<!-- FOOTER                                              -->
<!-- ═══════════════════════════════════════════════════ -->
<footer class="report-footer">
  Generated on ${escapeHtml(generatedAt)} by Lulu Island Flagship — Financial Core v9<br>
  Prepared in accordance with ASPE (Canadian GAAP for private enterprises)<br>
  All amounts in Canadian Dollars (CAD)
</footer>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Crea un adaptador PDF (HTML print-ready) para estados financieros.
 *
 * Genera P&L, Balance Sheet y Cash Flow en un solo documento HTML con
 * CSS optimizado para impresión. El output se puede:
 *   - Abrir en el navegador y guardar como PDF (Cmd+P → Save as PDF).
 *   - Pasar a un headless browser (Puppeteer/Playwright) para generar PDF
 *     programáticamente en el servidor.
 *
 * @param entries Arreglo completo de entradas del `financial_ledger`.
 * @param options Opciones de personalización (companyName, currencySymbol, etc.).
 * @returns Una instancia de `AccountingAdapter` que exporta a HTML print-ready.
 *
 * @example
 * ```ts
 * const adapter = createPdfAdapter(entries, {
 *   companyName: "Lulu Island Flagship Inc.",
 *   beginningCashCents: 2500000, // $25,000.00 opening balance
 * });
 * const html = adapter.exportJournalEntries("2026-08");
 * // Abrir html en browser, imprimir como PDF.
 * ```
 */
export const createPdfAdapter = (
  entries: FinancialLedgerEntry[],
  options?: PdfAdapterOptions
): AccountingAdapter => {
  const opts: Required<PdfAdapterOptions> = { ...DEFAULTS, ...options };

  return {
    formatName: "PDF Financial Statements",
    mimeType: "text/html",
    fileExtension: ".html",

    exportJournalEntries(periodo: string): string {
      const periodStart = startOfMonth(periodo);
      const periodEnd = endOfMonth(periodo);

      // 1. Profit & Loss para el período
      const pnl = generatePnL(entries, periodo);

      // 2. Balance Sheet al cierre del período
      const bs = generateBalanceSheet(entries, periodEnd);

      // 3. Cash Flow (usa net income + depreciation del P&L)
      const cf = generateCashFlow(
        entries,
        periodStart,
        periodEnd,
        pnl.netIncomeCents,
        pnl.depreciationCents,
        opts.beginningCashCents
      );

      return buildHtmlDocument(pnl, bs, cf, periodo, opts);
    },
  };
};

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Función de conveniencia: genera estados financieros en HTML print-ready
 * directamente sin necesidad de crear el adaptador manualmente.
 *
 * Equivalente a:
 * ```ts
 * createPdfAdapter(entries, options).exportJournalEntries(periodo)
 * ```
 *
 * @param entries Arreglo completo de entradas del ledger financiero.
 * @param periodo Período contable en formato YYYY-MM.
 * @param options Opciones de personalización.
 * @returns String HTML con P&L + Balance Sheet + Cash Flow, CSS print-friendly.
 */
export function exportFinancialStatementsAsPdf(
  entries: FinancialLedgerEntry[],
  periodo: string,
  options?: PdfAdapterOptions
): string | Buffer {
  return createPdfAdapter(entries, options).exportJournalEntries(periodo);
}

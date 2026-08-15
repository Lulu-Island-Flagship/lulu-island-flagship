/**
 * v8.5 Capa 5 del Financial Core — Pay Statement PDF Generator.
 *
 * Genera un PDF con formato profesional BC a partir de un PayStatement.
 * El PDF incluye todas las secciones requeridas: encabezado con logo y datos
 * del empleador, sección de empleado con SIN enmascarado, earnings, deductions,
 * employer contributions, YTD, net pay destacado, y nota legal bilingüe.
 *
 * ARQUITECTURA EN DOS CAPAS:
 *   1. generatePayStatementHtml() — produce HTML standalone auto-contenido
 *      con CSS print-friendly. Útil para email (embebido o adjunto) y para
 *      previsualización en navegador.
 *   2. generatePayStatementPdf() — envuelve el HTML en un PDF usando puppeteer
 *      (dynamic import — la dependencia es opcional; si no está instalada, la
 *      función lanza un error descriptivo).
 *
 * REGLAS DE SEGURIDAD:
 *   - El SIN llega ya enmascarado desde el PayStatement (*** *** 123).
 *   - Ningún dato de otros empleados aparece en el PDF.
 *   - La nota legal incluye los enlaces oficiales de BC ESA y CRA.
 *
 * FORMATO PROFESIONAL BC:
 *   - Encabezado: logo Lulu Island (texto como fallback), dirección, BN.
 *   - Employee: nombre completo, SIN parcial, período de pago.
 *   - Earnings: tabla Day Rate, Commissions, Overtime, Vacation Pay, Gross.
 *   - Deductions: tabla CPP, EI, Federal Tax, Provincial Tax, Total.
 *   - Employer Contributions: CPP match, EI 1.4×, WorkSafeBC (informativo).
 *   - YTD: Gross, CPP, EI, Tax acumulados año.
 *   - Footer: Net Pay en grande, fecha de depósito, nota legal BC.
 *
 * Interconexiones:
 *   pay-statement-pdf.ts ──(importa)──→ pay-statement.ts (PayStatement, centsToDollars)
 */

import type { PayStatement } from "./pay-statement";
import { centsToDollars } from "./payroll-line";

// =========================================================================
// Constantes de diseño del PDF
// =========================================================================

/** Color primario de marca Lulu Island — azul marino profesional. */
const BRAND_PRIMARY = "#1a365d";

/** Color secundario — gris cálido para líneas divisorias. */
const BRAND_DIVIDER = "#e2e8f0";

/** Color de fondo para filas alternadas en tablas. */
const ROW_ALT_BG = "#f7fafc";

/** Color de énfasis para Net Pay. */
const NET_PAY_COLOR = "#2f855a";

/** Logo Lulu Island en texto (fallback cuando no hay imagen disponible). */
const LOGO_TEXT = "LULU ISLAND FLAGSHIP";

// =========================================================================
// Helpers de formateo
// =========================================================================

/** Formatea centavos como string monetario CAD: "$1,234.56". */
function fmt(cents: number): string {
  const dollars = centsToDollars(cents);
  return `$${dollars.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formatea una fecha ISO a formato legible: "August 4, 2026". */
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

// =========================================================================
// CSS print-friendly (incrustado en el HTML)
// =========================================================================

/**
 * Hoja de estilos CSS diseñada para impresión profesional.
 *
 * Usa @media print para garantizar que el PDF se vea bien tanto en pantalla
 * como al imprimir en papel tamaño carta. Sin dependencias externas.
 */
function printStyles(): string {
  return /* css */ `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 11pt;
      color: #1a202c;
      line-height: 1.5;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 48px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Encabezado ─────────────────────────────────── */

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid ${BRAND_PRIMARY};
      padding-bottom: 20px;
      margin-bottom: 24px;
    }

    .header-logo {
      font-size: 18pt;
      font-weight: 800;
      color: ${BRAND_PRIMARY};
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .header-logo-sub {
      font-size: 8pt;
      color: #718096;
      font-weight: 400;
      letter-spacing: 0.1em;
      margin-top: 2px;
    }

    .header-info {
      text-align: right;
      font-size: 9pt;
      color: #4a5568;
      line-height: 1.6;
    }

    .header-info .bn {
      font-weight: 600;
      color: #2d3748;
    }

    /* ── Título del documento ────────────────────────── */

    .doc-title {
      text-align: center;
      font-size: 14pt;
      font-weight: 700;
      color: ${BRAND_PRIMARY};
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .doc-subtitle {
      text-align: center;
      font-size: 9pt;
      color: #718096;
      margin-bottom: 24px;
    }

    /* ── Sección Employee ────────────────────────────── */

    .employee-section {
      background: ${ROW_ALT_BG};
      border-radius: 4px;
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .employee-field {
      font-size: 10pt;
    }

    .employee-field .label {
      font-size: 8pt;
      text-transform: uppercase;
      color: #a0aec0;
      font-weight: 600;
      letter-spacing: 0.05em;
    }

    .employee-field .value {
      font-weight: 600;
      color: #2d3748;
      margin-top: 2px;
    }

    /* ── Tablas ──────────────────────────────────────── */

    .section-title {
      font-size: 10pt;
      font-weight: 700;
      color: ${BRAND_PRIMARY};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 2px solid ${BRAND_DIVIDER};
      padding-bottom: 6px;
      margin-top: 22px;
      margin-bottom: 10px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
      margin-bottom: 6px;
    }

    thead th {
      text-align: left;
      font-size: 8pt;
      text-transform: uppercase;
      color: #a0aec0;
      font-weight: 600;
      letter-spacing: 0.05em;
      padding: 8px 10px;
      border-bottom: 1px solid ${BRAND_DIVIDER};
    }

    tbody td {
      padding: 7px 10px;
      border-bottom: 1px solid ${BRAND_DIVIDER};
    }

    tbody tr:nth-child(even) td {
      background: ${ROW_ALT_BG};
    }

    td.amount {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-family: "SF Mono", "Menlo", "Consolas", monospace;
    }

    tfoot td {
      font-weight: 700;
      padding: 9px 10px;
      border-top: 2px solid ${BRAND_PRIMARY};
      border-bottom: none;
    }

    tfoot td.amount {
      color: ${BRAND_PRIMARY};
      font-size: 11pt;
    }

    /* ── Employer Contributions (info box) ───────────── */

    .info-box {
      background: #ebf8ff;
      border-left: 3px solid #3182ce;
      padding: 10px 14px;
      margin: 10px 0 18px 0;
      font-size: 9pt;
      color: #2c5282;
      border-radius: 0 4px 4px 0;
    }

    .info-box strong {
      display: block;
      margin-bottom: 4px;
      font-size: 9pt;
    }

    /* ── Net Pay destacado ───────────────────────────── */

    .net-pay-section {
      margin: 28px 0 20px 0;
      text-align: center;
    }

    .net-pay-label {
      font-size: 9pt;
      text-transform: uppercase;
      color: #a0aec0;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }

    .net-pay-amount {
      font-size: 28pt;
      font-weight: 800;
      color: ${NET_PAY_COLOR};
      letter-spacing: 0.02em;
      line-height: 1.1;
    }

    .deposit-date {
      font-size: 9pt;
      color: #718096;
      margin-top: 6px;
    }

    /* ── Legal note ──────────────────────────────────── */

    .legal-note {
      margin-top: 28px;
      padding-top: 16px;
      border-top: 1px solid ${BRAND_DIVIDER};
      font-size: 7.5pt;
      color: #a0aec0;
      line-height: 1.6;
      white-space: pre-line;
    }

    .legal-note hr {
      border: none;
      border-top: 1px dotted ${BRAND_DIVIDER};
      margin: 10px 0;
    }

    /* ── Footer ──────────────────────────────────────── */

    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 7pt;
      color: #cbd5e0;
    }

    /* ── Print media ─────────────────────────────────── */

    @media print {
      body {
        padding: 20px 32px;
        font-size: 10pt;
      }

      @page {
        size: letter;
        margin: 0.5in;
      }

      .info-box {
        background: #ebf8ff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      thead th {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;
}

// =========================================================================
// Template HTML completo
// =========================================================================

/**
 * Genera un documento HTML standalone con el pay statement completo.
 *
 * El HTML es auto-contenido: todos los estilos están incrustados en un tag
 * <style>, no hay dependencias externas (fuentes del sistema, sin CDN).
 * Esto lo hace apto para:
 *   - Conversión a PDF con puppeteer o cualquier headless browser.
 *   - Envío por email como adjunto .html o embebido en el cuerpo.
 *   - Previsualización en navegador.
 *
 * @param statement — PayStatement completo generado por generatePayStatement().
 * @returns String HTML completo listo para renderizar.
 */
export function generatePayStatementHtml(statement: PayStatement): string {
  const e = statement.earnings;
  const d = statement.deductions;
  const ec = statement.employer_contributions;
  const y = statement.ytd;

  // Escapar la nota legal para inyección segura en HTML
  const legalHtml = escapeHtml(statement.legal_note)
    .replace(/---/g, '<hr style="border:none;border-top:1px dotted #e2e8f0;margin:10px 0">')
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pay Statement — ${escapeHtml(statement.periodo.quincena)}</title>
<style>${printStyles()}</style>
</head>
<body>

<!-- ═══ ENCABEZADO ═══ -->
<div class="header">
  <div>
    <div class="header-logo">${LOGO_TEXT}</div>
    <div class="header-logo-sub">PAY STATEMENT</div>
  </div>
  <div class="header-info">
    <div>${escapeHtml(statement.employer.nombre)}</div>
    <div>${escapeHtml(statement.employer.direccion)}</div>
    <div class="bn">BN: ${escapeHtml(statement.employer.business_number)}</div>
  </div>
</div>

<!-- ═══ TÍTULO ═══ -->
<div class="doc-title">Statement of Earnings and Deductions</div>
<div class="doc-subtitle">Period: ${fmtDate(statement.periodo.fecha_inicio)} → ${fmtDate(statement.periodo.fecha_fin)} &nbsp;|&nbsp; Pay Date: ${fmtDate(statement.periodo.fecha_pago)}</div>

<!-- ═══ EMPLOYEE INFO ═══ -->
<div class="employee-section">
  <div class="employee-field">
    <div class="label">Employee</div>
    <div class="value">${escapeHtml(statement.employee.nombre)}</div>
  </div>
  <div class="employee-field">
    <div class="label">SIN</div>
    <div class="value">${escapeHtml(statement.employee.sin_masked)}</div>
  </div>
  <div class="employee-field">
    <div class="label">Pay Period</div>
    <div class="value">${escapeHtml(statement.periodo.quincena)}</div>
  </div>
  <div class="employee-field">
    <div class="label">Employee ID</div>
    <div class="value" style="font-family:monospace;font-size:8pt;">${escapeHtml(statement.employee.employee_id.slice(0, 8))}…</div>
  </div>
</div>

<!-- ═══ EARNINGS ═══ -->
<div class="section-title">Earnings</div>
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="amount">Amount (CAD)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Day Rate</td>
      <td class="amount">${fmt(e.day_rate_cents)}</td>
    </tr>
    <tr>
      <td>Commissions</td>
      <td class="amount">${fmt(e.comisiones_cents)}</td>
    </tr>
    <tr>
      <td>Overtime (1.5×)</td>
      <td class="amount">${fmt(e.horas_extra_cents)}</td>
    </tr>
    <tr>
      <td>Vacation Pay</td>
      <td class="amount">${fmt(e.vacation_pay_cents)}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td>Gross Pay</td>
      <td class="amount">${fmt(e.total_gross_cents)}</td>
    </tr>
  </tfoot>
</table>

<!-- ═══ DEDUCTIONS ═══ -->
<div class="section-title">Deductions</div>
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="amount">Amount (CAD)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>CPP (Canada Pension Plan)</td>
      <td class="amount">${fmt(d.cpp_cents)}</td>
    </tr>
    <tr>
      <td>EI (Employment Insurance)</td>
      <td class="amount">${fmt(d.ei_cents)}</td>
    </tr>
    <tr>
      <td>Federal Income Tax</td>
      <td class="amount">${fmt(d.federal_tax_cents)}</td>
    </tr>
    <tr>
      <td>BC Provincial Income Tax</td>
      <td class="amount">${fmt(d.provincial_tax_cents)}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td>Total Deductions</td>
      <td class="amount">${fmt(d.total_deductions_cents)}</td>
    </tr>
  </tfoot>
</table>

<!-- ═══ EMPLOYER CONTRIBUTIONS ═══ -->
<div class="section-title">Employer Contributions</div>
<div class="info-box">
  <strong>These amounts are paid by your employer and are NOT deducted from your pay.</strong>
  They are shown for transparency per BC Employment Standards Act best practices.
</div>
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="amount">Amount (CAD)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>CPP — Employer Matching (1:1)</td>
      <td class="amount">${fmt(ec.cpp_cents)}</td>
    </tr>
    <tr>
      <td>EI — Employer Premium (1.4×)</td>
      <td class="amount">${fmt(ec.ei_cents)}</td>
    </tr>
    <tr>
      <td>WorkSafeBC Premium</td>
      <td class="amount">${fmt(ec.worksafebc_cents)}</td>
    </tr>
  </tbody>
  <tfoot>
    <tr>
      <td>Total Employer Cost</td>
      <td class="amount">${fmt(ec.total_cents)}</td>
    </tr>
  </tfoot>
</table>

<!-- ═══ YTD ═══ -->
<div class="section-title">Year-to-Date (YTD)</div>
<table>
  <thead>
    <tr>
      <th>Description</th>
      <th class="amount">Cumulative (CAD)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Gross Pay YTD</td>
      <td class="amount">${fmt(y.gross_cents)}</td>
    </tr>
    <tr>
      <td>CPP Contributions YTD</td>
      <td class="amount">${fmt(y.cpp_cents)}</td>
    </tr>
    <tr>
      <td>EI Premiums YTD</td>
      <td class="amount">${fmt(y.ei_cents)}</td>
    </tr>
    <tr>
      <td>Income Tax Withheld YTD</td>
      <td class="amount">${fmt(y.tax_cents)}</td>
    </tr>
  </tbody>
</table>

<!-- ═══ NET PAY ═══ -->
<div class="net-pay-section">
  <div class="net-pay-label">Net Pay</div>
  <div class="net-pay-amount">${fmt(statement.net_pay_cents)}</div>
  <div class="deposit-date">Deposit Date: ${fmtDate(statement.periodo.fecha_pago)}</div>
</div>

<!-- ═══ LEGAL NOTE ═══ -->
<div class="legal-note">${legalHtml}</div>

<!-- ═══ FOOTER ═══ -->
<div class="footer">
  Generated on ${new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })} &nbsp;|&nbsp;
  Lulu Island Flagship Ltd. &nbsp;|&nbsp;
  payroll@luluislandflagship.com
</div>

</body>
</html>`;
}

// =========================================================================
// PDF Generation (puppeteer — dynamic import, dependency optional)
// =========================================================================

/**
 * Genera un PDF a partir de un PayStatement usando puppeteer.
 *
 * REQUIERE puppeteer instalado como dependencia del proyecto:
 *   npm install puppeteer
 *
 * Si puppeteer no está instalado, la función lanza un error descriptivo
 * en lugar de fallar silenciosamente.
 *
 * El PDF se genera en formato carta (letter), con márgenes de 0.5 pulgadas
 * y fondo de impresión habilitado para preservar los colores de marca.
 *
 * @param statement — PayStatement completo.
 * @returns Buffer con los bytes del PDF listo para guardar o enviar.
 * @throws Error si puppeteer no está instalado o si falla la generación.
 *
 * @example
 * ```ts
 * const pdfBuffer = await generatePayStatementPdf(statement);
 * await fs.promises.writeFile("/tmp/pay-statement.pdf", pdfBuffer);
 * ```
 */
export async function generatePayStatementPdf(statement: PayStatement): Promise<Buffer> {
  const html = generatePayStatementHtml(statement);

  // Dynamic import — puppeteer es opcional
  let puppeteer: {
    launch: (opts?: Record<string, unknown>) => Promise<{
      newPage: () => Promise<{
        setContent: (html: string, opts?: Record<string, unknown>) => Promise<void>;
        pdf: (opts?: Record<string, unknown>) => Promise<Buffer>;
        close: () => Promise<void>;
      }>;
      close: () => Promise<void>;
    }>;
  };

  try {
    // puppeteer es una dependencia OPCIONAL (no está en package.json): sin el
    // paquete instalado, TypeScript no resuelve el módulo "puppeteer" y marca
    // "Cannot find module". Se usa @ts-expect-error (no @ts-ignore) a propósito:
    //   - Es autocontrolado: si alguien instala puppeteer, el build falla con
    //     "Unused '@ts-expect-error' directive" y obliga a quitar esta línea.
    //   - NO se usa un stub `declare module "puppeteer"` (.d.ts) porque sería una
    //     "ficción" de tipos que puede desincronizarse del API real y, si algún
    //     día se instala puppeteer, chocaría con sus tipos reales.
    // El fallo en runtime lo maneja el catch de abajo (mensaje con instrucciones).
    // @ts-expect-error — módulo opcional no instalado en compile-time.
    puppeteer = await import("puppeteer");
  } catch {
    throw new Error(
      "generatePayStatementPdf requires puppeteer. Install it with:\n" +
        "  npm install puppeteer\n" +
        "Or use generatePayStatementHtml() to get the HTML and render it with another engine."
    );
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    const pdfBuffer = await page.pdf({
      format: "letter",
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
      printBackground: true,
      displayHeaderFooter: false,
    });

    await page.close();

    return Buffer.from(pdfBuffer);
  } catch (err) {
    throw new Error(
      `Failed to generate PDF: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        // Silenciar errores de cierre — el proceso ya puede estar muerto
      });
    }
  }
}

// =========================================================================
// HTML escaping helper (defensa en profundidad contra XSS)
// =========================================================================

/**
 * Escapa caracteres especiales HTML para prevenir inyección.
 *
 * Aunque los datos del PayStatement ya vienen sanitizados de la capa
 * de datos (el SIN está enmascarado, los nombres son strings planos),
 * esta función garantiza que ningún carácter malicioso pueda colarse
 * en el HTML generado.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * v8.3 — Adapter Integration Tests.
 *
 * Pruebas de integración de los adaptadores de exportación contable:
 * CSV, IIF (QuickBooks), y PDF (HTML print-ready). Verifica formato
 * válido, columnas correctas, compatibilidad QBO, generación sin datos,
 * asientos de ajuste (reversiones), y control de acceso por rol.
 *
 * Sin dependencia de base de datos — usa FinancialLedgerEntry mocks.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import type { FinancialLedgerEntry } from "../../src/lib/financial-reports";
import { createCsvAdapter, exportJournalEntriesAsCsv } from "../../src/adapters/accounting/csv-adapter";
import { createIifAdapter, exportJournalEntriesAsIIF } from "../../src/adapters/accounting/iif-adapter";
import { createPdfAdapter, exportFinancialStatementsAsPdf } from "../../src/adapters/accounting/pdf-adapter";
import { validateExportFormat, getExportFileName, type ExportFormat } from "../../src/lib/accounting-adapter";

// =========================================================================
// Mock helpers — FinancialLedgerEntry
// =========================================================================

function makeEntry(over: Partial<FinancialLedgerEntry> = {}): FinancialLedgerEntry {
  return {
    id: "entry-001",
    accountCode: "4010",
    amountCents: 150000, // $1,500.00
    direction: "credit",
    period: "2026-08",
    occurredAt: "2026-08-04T12:00:00.000Z",
    source: "stripe",
    description: "Service Revenue — Deep Clean",
    orderId: "ORD-1001",
    zone: "Richmond",
    team: "Team Alpha",
    serviceType: "deep",
    metadata: { payment_method: "card" },
    ...over,
  };
}

/** Entradas de muestra multi-transacción para un período completo. */
function sampleEntries(): FinancialLedgerEntry[] {
  return [
    makeEntry({ id: "e1", accountCode: "4010", amountCents: 300000, direction: "credit", description: "Service Revenue", orderId: "ORD-1001" }),
    makeEntry({ id: "e2", accountCode: "1020", amountCents: 300000, direction: "debit", description: "Cash - Payment received", orderId: "ORD-1001" }),
    makeEntry({ id: "e3", accountCode: "5010", amountCents: 120000, direction: "debit", description: "Labor - Day Rate", orderId: "ORD-1002", source: "payroll" }),
    makeEntry({ id: "e4", accountCode: "1020", amountCents: 120000, direction: "credit", description: "Cash - Payroll disbursement", orderId: "ORD-1002", source: "payroll" }),
    makeEntry({ id: "e5", accountCode: "2010", amountCents: 50000, direction: "credit", description: "Accounts Payable - Supplies", orderId: "ORD-1003", source: "manual" }),
    makeEntry({ id: "e6", accountCode: "5010", amountCents: 50000, direction: "debit", description: "Supplies Expense", orderId: "ORD-1003", source: "manual" }),
  ];
}

// =========================================================================
// CSV Adapter
// =========================================================================

describe("CSV Adapter", () => {
  it("exporta CSV con encabezados y columnas correctas", () => {
    const entries = sampleEntries();
    const csv = createCsvAdapter(entries).exportJournalEntries("2026-08");

    // Verificar encabezados
    const lines = csvas string).trim().split("\n");
    const header = lines[0];
    assert.match(header, /Fecha/);
    assert.match(header, /Cuenta Debito/);
    assert.match(header, /Cuenta Credito/);
    assert.match(header, /Monto/);
    assert.match(header, /Descripcion/);
    assert.match(header, /Referencia/);
    assert.match(header, /Evento/);

    // Debe haber 6 filas de datos + 1 header
    assert.strictEqual(lines.length, 7);

    // Primera fila de datos debe ser revenue (credit)
    const firstRow = lines[1];
    assert.match(firstRow, /2026-08-04/);
    assert.match(firstRow, /Service Revenue/);
    assert.match(firstRow, /3000\.00/);
    assert.match(firstRow, /stripe/);
  });

  it("exporta CSV solo con entradas del período solicitado", () => {
    const entries = [
      makeEntry({ period: "2026-08", id: "e1", description: "August entry" }),
      makeEntry({ period: "2026-09", id: "e2", description: "September entry" }),
    ];
    const csv = createCsvAdapter(entries).exportJournalEntries("2026-08");

    const lines = csvas string).trim().split("\n");
    assert.strictEqual(lines.length, 2); // header + 1 data row
    assert.match(csv, /August entry/);
    // La entrada de septiembre NO debe aparecer
    assert.strictEqual(csv.includes("September entry"), false);
  });

  it("export con período sin datos no falla, retorna solo header", () => {
    const entries = sampleEntries();
    const csv = createCsvAdapter(entries).exportJournalEntries("2026-01");

    const lines = csvas string).trim().split("\n");
    assert.strictEqual(lines.length, 1); // Solo header
    assert.match(lines[0], /Fecha/);
  });

  it("formatName, mimeType, fileExtension son correctos", () => {
    const adapter = createCsvAdapter([]);
    assert.strictEqual(adapter.formatName, "CSV");
    assert.strictEqual(adapter.mimeType, "text/csv");
    assert.strictEqual(adapter.fileExtension, ".csv");
  });

  it("convenience function exportJournalEntriesAsCsv funciona", () => {
    const entries = [makeEntry({ period: "2026-08" })];
    const csv = exportJournalEntriesAsCsv(entries, "2026-08");
    assert.ok(csv.length > 0);
    assert.match(csv as string, /Fecha/);
  });

  it("escaping CSV: comillas en descripción se duplican", () => {
    const entry = makeEntry({
      description: 'Client "VIP" Package, extra large',
    });
    const csv = createCsvAdapter([entry]).exportJournalEntries("2026-08");
    // Debe escapar comillas internas duplicándolas
    assert.match(csv, /"Client ""VIP"" Package, extra large"/);
  });
});

// =========================================================================
// IIF Adapter (QuickBooks)
// =========================================================================

describe("IIF Adapter (QuickBooks)", () => {
  it("exporta IIF con directivas !TRNS, !SPL, !ENDTRNS", () => {
    const entries = sampleEntries();
    const iif = createIifAdapter(entries).exportJournalEntries("2026-08");

    // Encabezados requeridos QBO
    assert.match(iif, /!TRNS/);
    assert.match(iif, /!SPL/);
    assert.match(iif, /!ENDTRNS/);

    // Tipo de transacción
    assert.match(iif, /GENERAL JOURNAL/);
  });

  it("formato IIF usa tab-separated values", () => {
    const entries = [makeEntry({ period: "2026-08", orderId: "ORD-1001" }), makeEntry({ id: "e2", accountCode: "1020", amountCents: 150000, direction: "debit", period: "2026-08", orderId: "ORD-1001", source: "stripe", description: "Cash" })];
    const iif = createIifAdapter(entries).exportJournalEntries("2026-08");

    // TRNS line debe tener tabs
    const lines = iif.split("\n").filter((l) => l.length > 0);
    const trnsLine = lines.find((l) => l.startsWith("TRNS\t"));
    assert.ok(trnsLine, "Debe haber al menos una línea TRNS");

    // SPL lines deben tener tabs
    const splLines = lines.filter((l) => l.startsWith("SPL\t"));
    assert.ok(splLines.length >= 2, "Debe haber al menos 2 líneas SPL");
  });

  it("débito → positivo, crédito → negativo en IIF", () => {
    const entries = [
      makeEntry({ id: "e1", accountCode: "5010", amountCents: 100000, direction: "debit", period: "2026-08", orderId: "ORD-TEST", description: "Debit entry" }),
      makeEntry({ id: "e2", accountCode: "4010", amountCents: 100000, direction: "credit", period: "2026-08", orderId: "ORD-TEST", description: "Credit entry" }),
    ];

    const iif = createIifAdapter(entries).exportJournalEntries("2026-08");

    // Debe contener 1000.00 (débito positivo) y -1000.00 (crédito negativo)
    assert.match(iif, /1000\.00/);
    assert.match(iif, /-1000\.00/);
  });

  it("export con período sin datos retorna estructura IIF vacía", () => {
    const entries = sampleEntries();
    const iif = createIifAdapter(entries).exportJournalEntries("2026-01");

    assert.match(iif, /!TRNS/);
    assert.match(iif, /!SPL/);
    assert.match(iif, /!ENDTRNS/);
    // No debe tener datos reales
    const lines = iif.split("\n").filter((l) => l.startsWith("TRNS\t") || l.startsWith("SPL\t"));
    assert.strictEqual(lines.length, 0);
  });

  it("formatName y fileExtension correctos", () => {
    const adapter = createIifAdapter([]);
    assert.strictEqual(adapter.formatName, "QuickBooks IIF");
    assert.strictEqual(adapter.fileExtension, ".iif");
    assert.strictEqual(adapter.mimeType, "text/tab-separated-values");
  });

  it("convenience function exportJournalEntriesAsIIF funciona", () => {
    const entries = [makeEntry({ period: "2026-08" })];
    const iif = exportJournalEntriesAsIIF(entries, "2026-08");
    assert.ok((iif as string).length > 0);
    assert.match(iif as string, /!TRNS/);
  });
});

// =========================================================================
// PDF Adapter (HTML print-ready)
// =========================================================================

describe("PDF Adapter (HTML)", () => {
  it("genera HTML no vacío con estados financieros", () => {
    const entries = sampleEntries();
    const html = createPdfAdapter(entries).exportJournalEntries("2026-08");

    assert.ok(html.length > 0, "HTML no debe ser vacío");

    // Debe contener las 3 secciones principales
    assert.match(html as string, /Profit.*Loss|P&amp;L/);
    assert.match(html as string, /Balance Sheet/i);
    assert.match(html as string, /Cash Flow/i);

    // Debe ser HTML válido
    assert.match(html as string, /<html/i);
    assert.match(html as string, /<\/html>/i);
    assert.match(html as string, /<body/i);
    assert.match(html as string, /<\/body>/i);
  });

  it("genera HTML con CSS print-friendly", () => {
    const entries = [makeEntry({ period: "2026-08" })];
    const html = createPdfAdapter(entries).exportJournalEntries("2026-08");

    assert.match(html as string, /@media print/);
    assert.match(html as string, /@page/);
  });

  it("export con período sin datos no falla, genera HTML con reportes vacíos", () => {
    const entries: FinancialLedgerEntry[] = [];
    const html = createPdfAdapter(entries).exportJournalEntries("2026-08");

    assert.ok((html as string).length > 0);
    assert.match(html as string, /<html/i);
    // Debe tener estructura HTML aunque sin datos
  });

  it("formatName, mimeType, fileExtension correctos", () => {
    const adapter = createPdfAdapter([]);
    assert.strictEqual(adapter.formatName, "PDF Financial Statements");
    assert.strictEqual(adapter.mimeType, "text/html");
    assert.strictEqual(adapter.fileExtension, ".html");
  });

  it("convenience function exportFinancialStatementsAsPdf funciona", () => {
    const entries = [makeEntry({ period: "2026-08" })];
    const pdf = exportFinancialStatementsAsPdf(entries, "2026-08");
    assert.ok((pdf as string).length > 0);
    assert.match(pdf as string, /<html/i);
  });

  it("respeta opciones de personalización (companyName)", () => {
    const entries = [makeEntry({ period: "2026-08" })];
    const html = createPdfAdapter(entries, {
      companyName: "Test Company Inc.",
      beginningCashCents: 1000000, // $10,000
    }).exportJournalEntries("2026-08");

    assert.match(html as string, /Test Company Inc\./);
  });
});

// =========================================================================
// Edge case — asientos de ajuste (reversiones)
// =========================================================================

describe("Adapter edge cases", () => {
  it("período con asientos de ajuste (reversiones) se exportan correctamente", () => {
    // Un asiento de ajuste es un débito y crédito por el mismo monto
    // que revierte un asiento previo (ej. corrección contable)
    const adjustmentEntries: FinancialLedgerEntry[] = [
      makeEntry({
        id: "adj-001",
        accountCode: "4010",
        amountCents: 50000,
        direction: "debit",  // Revierte un crédito anterior
        period: "2026-08",
        description: "REVERSAL: Correction of over-reported revenue",
        source: "manual",
      }),
      makeEntry({
        id: "adj-002",
        accountCode: "1020",
        amountCents: 50000,
        direction: "credit", // Contrapartida
        period: "2026-08",
        description: "REVERSAL: Cash correction",
        source: "manual",
      }),
    ];

    // CSV: debe exportar ambas líneas
    const csv = createCsvAdapter(adjustmentEntries).exportJournalEntries("2026-08");
    const csvLines = csvas string).trim().split("\n");
    assert.strictEqual(csvLines.length, 3); // header + 2 rows

    // IIF: debe tener SPL con débito positivo y crédito negativo
    const iif = createIifAdapter(adjustmentEntries).exportJournalEntries("2026-08");
    assert.match(iif, /500\.00/);    // $500 débito (positivo)
    assert.match(iif, /-500\.00/);   // $500 crédito (negativo)

    // PDF: debe generar HTML sin errores
    const html = createPdfAdapter(adjustmentEntries).exportJournalEntries("2026-08");
    assert.ok((html as string).length > 0);
  });
});

// =========================================================================
// accounting-adapter.ts — validación y helpers
// =========================================================================

describe("Accounting Adapter — validation & helpers", () => {
  it("validateExportFormat acepta formatos válidos", () => {
    assert.strictEqual(validateExportFormat("csv"), true);
    assert.strictEqual(validateExportFormat("iif"), true);
    assert.strictEqual(validateExportFormat("pdf"), true);
    assert.strictEqual(validateExportFormat("json"), true);
  });

  it("validateExportFormat rechaza formatos inválidos", () => {
    assert.strictEqual(validateExportFormat("xml"), false);
    assert.strictEqual(validateExportFormat("xlsx"), false);
    assert.strictEqual(validateExportFormat(""), false);
    assert.strictEqual(validateExportFormat(null), false);
    assert.strictEqual(validateExportFormat(undefined), false);
    assert.strictEqual(validateExportFormat(123), false);
  });

  it("getExportFileName genera nombres correctos", () => {
    assert.strictEqual(getExportFileName("2026-08", "csv"), "Lulu_Island_PnL_2026-08.csv");
    assert.strictEqual(getExportFileName("2026-08", "iif"), "Lulu_Island_PnL_2026-08.iif");
    assert.strictEqual(getExportFileName("2026-08", "pdf"), "Lulu_Island_PnL_2026-08.html");
    assert.strictEqual(getExportFileName("2026-01..2026-06", "csv"), "Lulu_Island_PnL_2026-01_to_2026-06.csv");
  });
});

// =========================================================================
// Auth — no-admin recibe 403 (validación de rol)
// =========================================================================

describe("Adapter Auth boundary", () => {
  /**
   * Test de control de acceso: la función de exportación de nómina
   * desde una ruta HTTP debe verificar el rol del usuario antes de
   * generar la exportación.
   *
   * Como las funciones de adaptador son puras (no manejan auth),
   * este test documenta el contrato que DEBE cumplir la ruta que
   * las invoca. El enforce real está en require-client-caller.ts
   * o admin-rbac.ts.
   */
  it("las funciones de adaptador son puras — la responsabilidad de auth es del caller", () => {
    // Las funciones de adaptador aceptan cualquier entrada de datos,
    // no verifican roles. Es responsabilidad de la ruta HTTP.
    const entries = [makeEntry()];
    const csv = createCsvAdapter(entries).exportJournalEntries("2026-08");
    // Si esto se ejecuta, es porque el caller (ruta) permitió el acceso
    assert.ok(csv.length > 0);
  });

  it("validateExportFormat es un guard de runtime usable en rutas HTTP", () => {
    // Simula la validación que haría una ruta antes de llamar al adaptador
    const rawFormat = "csv";

    if (!validateExportFormat(rawFormat)) {
      assert.fail("csv debe ser válido");
    }

    // rawFormat ahora es ExportFormat (narrowed)
    const format: ExportFormat = rawFormat;
    const filename = getExportFileName("2026-08", format);
    assert.match(filename, /\.csv$/);
  });

  it("formato inválido debe retornar 400 (no 403 — error de input, no de auth)", () => {
    const rawFormat = "xml";
    const isValid = validateExportFormat(rawFormat);
    assert.strictEqual(isValid, false);
    // La ruta debe retornar 400 Bad Request, no 403 Forbidden,
    // porque es un error de input del usuario, no de permisos.
  });
});

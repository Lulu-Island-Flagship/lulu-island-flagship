/**
 * Capa 9 — CSV Accounting Adapter.
 *
 * Exporta asientos contables en formato CSV estándar listo para importación
 * en cualquier software contable: QuickBooks Desktop, Xero, Sage, Wave, o
 * simplemente para abrir en Excel / Google Sheets.
 *
 * Columnas: Fecha, Cuenta Debito, Cuenta Credito, Monto, Descripcion,
 *           Referencia, Evento.
 *
 * Convenciones:
 *   - Montos en dólares canadienses (CAD) con 2 decimales (no centavos).
 *   - Fechas ISO 8601 (YYYY-MM-DD) para ordenamiento consistente.
 *   - Valores escapados según RFC 4180 (comillas dobles para celdas con
 *     comas, saltos de línea o comillas literales).
 *
 * Regla de oro: Solo export. Nunca lee de QBO/Xero.
 */

import type { FinancialLedgerEntry } from "@/lib/financial-reports";
import { getCuentaByCodigo } from "@/lib/coa";
import type {
  AccountingAdapter,
  AccountingAdapterFactory,
} from "@/lib/accounting-adapter";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Columnas del CSV en orden canónico. */
const CSV_HEADERS = [
  "Fecha",
  "Cuenta Debito",
  "Cuenta Credito",
  "Monto",
  "Descripcion",
  "Referencia",
  "Evento",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convierte centavos (entero) a string con formato dólar canadiense
 * con exactamente 2 decimales.
 */
function centsToDollar(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Escapa un valor para CSV según RFC 4180.
 *
 * Solo encierra en comillas si el valor contiene coma, comillas dobles,
 * o salto de línea. Las comillas internas se duplican.
 */
function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Obtiene el nombre legible de una cuenta desde el COA.
 * Si el código no existe en el COA, devuelve el código tal cual.
 */
function getAccountName(code: string): string {
  const cuenta = getCuentaByCodigo(code);
  return cuenta?.nombre ?? code;
}

// ---------------------------------------------------------------------------
// CSV generation
// ---------------------------------------------------------------------------

/**
 * Genera las filas de datos CSV para un período contable.
 *
 * Filtra las entradas por `period`, las ordena por fecha ascendente,
 * y mapea cada entrada a una fila CSV con las columnas canónicas.
 */
function generateCsvRows(
  entries: FinancialLedgerEntry[],
  periodo: string
): string[] {
  const filtered = entries
    .filter((e) => e.period === periodo)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return filtered.map((entry) => {
    const accountName = getAccountName(entry.accountCode);
    const debitAccount = entry.direction === "debit" ? accountName : "";
    const creditAccount = entry.direction === "credit" ? accountName : "";
    const description = entry.description ?? "";
    // Usar orderId como referencia principal; caer en entry.id si no hay.
    const reference = entry.orderId ?? entry.id;
    const eventType = entry.source;

    return [
      entry.occurredAt.slice(0, 10),          // Fecha (YYYY-MM-DD)
      escapeCsv(debitAccount),                 // Cuenta Debito
      escapeCsv(creditAccount),                // Cuenta Credito
      centsToDollar(entry.amountCents),        // Monto (CAD)
      escapeCsv(description),                  // Descripcion
      escapeCsv(reference),                    // Referencia
      escapeCsv(eventType),                    // Evento (fuente)
    ].join(",");
  });
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Crea un adaptador CSV para exportación de asientos contables.
 *
 * @param entries Arreglo completo de entradas del `financial_ledger`.
 * @returns Una instancia de `AccountingAdapter` que exporta a CSV.
 *
 * @example
 * ```ts
 * const adapter = createCsvAdapter(entries);
 * const csv = adapter.exportJournalEntries("2026-08");
 * // Descargar o guardar csv como "journal-2026-08.csv"
 * ```
 */
export const createCsvAdapter: AccountingAdapterFactory = (
  entries: FinancialLedgerEntry[]
): AccountingAdapter => ({
  formatName: "CSV",
  mimeType: "text/csv",
  fileExtension: ".csv",

  exportJournalEntries(periodo: string): string {
    const header = CSV_HEADERS.join(",");
    const rows = generateCsvRows(entries, periodo);
    return [header, ...rows].join("\n") + "\n";
  },
});

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Función de conveniencia: exporta asientos contables a CSV directamente
 * sin necesidad de crear el adaptador manualmente.
 *
 * Equivalente a:
 * ```ts
 * createCsvAdapter(entries).exportJournalEntries(periodo)
 * ```
 *
 * @param entries Arreglo completo de entradas del ledger financiero.
 * @param periodo Período contable en formato YYYY-MM.
 * @returns String CSV con encabezados y filas de datos.
 */
export function exportJournalEntriesAsCsv(
  entries: FinancialLedgerEntry[],
  periodo: string
): string | Buffer {
  return createCsvAdapter(entries).exportJournalEntries(periodo);
}

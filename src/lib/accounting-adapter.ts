/**
 * Capa 9 — Accounting Adapter: Interfaz Común.
 *
 * Define el contrato que todo adaptador de exportación contable debe cumplir.
 * Cada implementación recibe las entradas del ledger financiero, las filtra
 * por período y produce la salida en su formato nativo (CSV, IIF, HTML/PF o XML).
 *
 * Regla de oro: El sistema NUNCA lee de QBO/Xero. Solo escribe hacia ellos
 * si el admin lo solicita explícitamente. No hay sync bidireccional. No hay
 * import desde QBO/Xero. Solo export.
 *
 * Dependencias:
 *   - financial-reports.ts: FinancialLedgerEntry (tipo de entrada del ledger).
 */

import type { FinancialLedgerEntry } from "@/lib/financial-reports";

/**
 * Interfaz común para todos los adaptadores de exportación contable.
 *
 * Cada implementación recibe las entradas completas del ledger financiero
 * en su factory, y produce la salida en el formato específico del adaptador
 * cuando el caller invoca `exportJournalEntries(periodo)`.
 */
export interface AccountingAdapter {
  /**
   * Exporta los asientos contables del período al formato del adaptador.
   *
   * @param periodo Período contable en formato YYYY-MM.
   * @returns String para formatos de texto (CSV, IIF, HTML, XML) o
   *          Buffer para formatos binarios (PDF real, aunque en esta
   *          implementación el adaptador PDF devuelve HTML listo para
   *          imprimir).
   */
  exportJournalEntries(periodo: string): string | Buffer;

  /** Nombre legible del formato (ej. "CSV", "QuickBooks IIF", "PDF Statements"). */
  readonly formatName: string;

  /** MIME type del contenido generado (ej. "text/csv", "text/html"). */
  readonly mimeType: string;

  /** Extensión de archivo recomendada para el output (ej. ".csv", ".iif", ".html"). */
  readonly fileExtension: string;
}

/**
 * Tipo de función factory para crear instancias de `AccountingAdapter`.
 *
 * El caller lee todas las entradas del `financial_ledger` desde la base de
 * datos, las pasa a la factory, y obtiene un adaptador listo para exportar
 * por período.
 */
export type AccountingAdapterFactory = (
  entries: FinancialLedgerEntry[]
) => AccountingAdapter;

/**
 * Adaptador no-op que devuelve un string vacío para todo período.
 *
 * Útil como fallback cuando el administrador no ha configurado un formato
 * de exportación o cuando no hay entradas que procesar — evita condicionales
 * de "adapter disponible o no" en el código que consume la interfaz.
 */
export function createNoopAdapter(): AccountingAdapter {
  return {
    formatName: "None",
    mimeType: "text/plain",
    fileExtension: ".txt",
    exportJournalEntries(_periodo: string): string {
      return "";
    },
  };
}

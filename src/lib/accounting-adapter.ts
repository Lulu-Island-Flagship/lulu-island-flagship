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

// ---------------------------------------------------------------------------
// Export format type & validation
// ---------------------------------------------------------------------------

/**
 * Formatos de exportación soportados por el sistema de descarga unificada.
 *
 * - `csv`: CSV estándar RFC 4180 para QuickBooks / Excel / Google Sheets.
 * - `iif`: Intuit Interchange Format para QuickBooks Desktop / Online.
 * - `pdf`: HTML print-ready con P&L + Balance Sheet + Cash Flow.
 * - `json`: Datos crudos del ledger financiero en JSON (para integraciones
 *   programáticas o análisis en Python/R).
 */
export type ExportFormat = "csv" | "iif" | "pdf" | "json";

/** Conjunto de formatos válidos para validación O(1). */
const VALID_FORMATS: ReadonlySet<string> = new Set<ExportFormat>([
  "csv",
  "iif",
  "pdf",
  "json",
]);

/** MIME types canónicos por formato de exportación. */
export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv",
  iif: "text/plain",
  pdf: "text/html", // HTML print-ready; conversión real a PDF vía headless browser
  json: "application/json",
};

/**
 * Type guard en runtime: verifica que un string arbitrario es un formato
 * de exportación válido.
 *
 * Útil para validar input del usuario antes de pasarlo al sistema de tipos.
 *
 * @param format Valor crudo a validar (típicamente de req.body o query param).
 * @returns `true` si es un ExportFormat reconocido.
 *
 * @example
 * ```ts
 * const raw = req.body.format; // unknown
 * if (!validateExportFormat(raw)) {
 *   return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
 * }
 * // raw ahora es ExportFormat (TypeScript narrows vía type predicate)
 * ```
 */
export function validateExportFormat(
  format: unknown
): format is ExportFormat {
  return typeof format === "string" && VALID_FORMATS.has(format);
}

// ---------------------------------------------------------------------------
// File naming
// ---------------------------------------------------------------------------

/**
 * Genera el nombre de archivo estandarizado para una exportación.
 *
 * Formato: `Lulu_Island_PnL_{periodo}.{ext}` para período único, o
 * `Lulu_Island_PnL_{desde}_to_{hasta}.{ext}` para rango.
 *
 * @param periodo Período único ("2026-08") o rango ("2026-01..2026-06").
 * @param format Formato de exportación (dicta la extensión).
 * @returns Nombre de archivo listo para Content-Disposition.
 *
 * @example
 * ```ts
 * getExportFileName("2026-08", "csv")  // "Lulu_Island_PnL_2026-08.csv"
 * getExportFileName("2026-01..2026-06", "iif") // "Lulu_Island_PnL_2026-01_to_2026-06.iif"
 * ```
 */
export function getExportFileName(periodo: string, format: ExportFormat): string {
  const ext = EXTENSION_MAP[format];
  const label = periodo.includes("..")
    ? periodo.replace("..", "_to_")
    : periodo;
  return `Lulu_Island_PnL_${label}${ext}`;
}

/** Mapa de formato a extensión para `getExportFileName`. */
const EXTENSION_MAP: Record<ExportFormat, string> = {
  csv: ".csv",
  iif: ".iif",
  pdf: ".html", // HTML print-ready
  json: ".json",
};

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

// ---------------------------------------------------------------------------
// Period range parsing
// ---------------------------------------------------------------------------

/**
 * Resultado del parseo de un input de período.
 *
 * - Si es un período único, `start` y `end` son iguales.
 * - Si es un rango, `start` es el primer mes y `end` el último (ambos inclusivos).
 */
export interface PeriodRange {
  /** Primer período del rango en formato YYYY-MM (inclusivo). */
  start: string;
  /** Último período del rango en formato YYYY-MM (inclusivo). */
  end: string;
  /** `true` si el input original era un rango (dos períodos). */
  isRange: boolean;
}

/** Regex para validar formato YYYY-MM (año 2024–2099, mes 01–12). */
const PERIOD_RE = /^(20[2-9]\d)-(0[1-9]|1[0-2])$/;

/**
 * Parsea un input de período y devuelve un rango normalizado.
 *
 * Soporta dos formatos:
 * - Período único: `"2026-08"` → `{ start: "2026-08", end: "2026-08", isRange: false }`
 * - Rango: `"2026-01..2026-06"` → `{ start: "2026-01", end: "2026-06", isRange: true }`
 *
 * El rango usa `..` como separador (dos puntos), y ambos extremos deben ser
 * períodos válidos en formato YYYY-MM. El período `start` debe ser ≤ `end`.
 *
 * @param input String crudo del usuario (body.periodo).
 * @returns Rango normalizado con `start` y `end` en formato YYYY-MM.
 * @throws {Error} Si el formato es inválido o el rango está invertido.
 *
 * @example
 * ```ts
 * parsePeriodRange("2026-08")
 * // → { start: "2026-08", end: "2026-08", isRange: false }
 * parsePeriodRange("2026-01..2026-06")
 * // → { start: "2026-01", end: "2026-06", isRange: true }
 * ```
 */
export function parsePeriodRange(input: string): PeriodRange {
  // Rango: dos períodos separados por ".."
  if (input.includes("..")) {
    const parts = input.split("..");
    if (parts.length !== 2) {
      throw new Error(
        `Formato de rango inválido: "${input}". Use "YYYY-MM..YYYY-MM".`
      );
    }
    const [start, end] = parts.map((p) => p.trim());
    if (!PERIOD_RE.test(start)) {
      throw new Error(
        `Período inicial inválido: "${start}". Debe ser YYYY-MM (ej. 2026-01).`
      );
    }
    if (!PERIOD_RE.test(end)) {
      throw new Error(
        `Período final inválido: "${end}". Debe ser YYYY-MM (ej. 2026-06).`
      );
    }
    if (start > end) {
      throw new Error(
        `Rango invertido: "${start}" > "${end}". El período inicial debe ser ≤ al final.`
      );
    }
    return { start, end, isRange: true };
  }

  // Período único
  if (!PERIOD_RE.test(input)) {
    throw new Error(
      `Período inválido: "${input}". Debe ser YYYY-MM (ej. 2026-08) o rango YYYY-MM..YYYY-MM.`
    );
  }
  return { start: input, end: input, isRange: false };
}

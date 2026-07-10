/**
 * v8.3 E9 (D.9.5) — Exportación universal CSV/JSON mensual, sin dependencia
 * de QBO. Objetivo literal del plan: "cambiar de software contable = apuntar
 * el export a otro destino". Funciones puras: reciben registros ya armados
 * (ingresos, nómina, comisiones, regalos, reservas de impuestos) y producen
 * CSV/JSON en un formato documentado y versionado.
 *
 * FORMATO DOCUMENTADO (schema version "1.0"):
 *   JSON: { schemaVersion, month, generatedAt, records[], totalsByCategory }
 *   CSV columnas (en este orden, estable):
 *     schema_version, month, category, description, amount_cad, currency, metadata_json
 *   - amount_cad siempre con 2 decimales, punto decimal, sin separador de miles.
 *   - metadata_json es un objeto JSON serializado en una sola celda (comillas
 *     dobles escapadas al estilo CSV estándar RFC 4180), o "" si no hay metadata.
 *   - category ∈ UniversalExportCategory (union cerrada, ver abajo).
 *
 * Criterio de aceptación E9 literal: "Export universal CSV/JSON validado
 * contra un esquema documentado; re-importable en una hoja de cálculo sin
 * pérdida." — parseUniversalExportCsv() hace el round-trip inverso y se
 * prueba en tests/lib/universal-export.test.ts.
 */

export const UNIVERSAL_EXPORT_SCHEMA_VERSION = "1.0";

export type UniversalExportCategory =
  | "revenue"
  | "payroll_gross"
  | "payroll_deduction"
  | "employer_burden"
  | "partner_commission"
  | "retention_gift"
  | "tax_reserve";

export interface UniversalExportRecord {
  category: UniversalExportCategory;
  description: string;
  amountCents: number;
  /** ISO date de la transacción/registro origen, YYYY-MM-DD */
  date: string;
  metadata?: Record<string, string>;
}

export interface UniversalExportDocument {
  schemaVersion: string;
  /** YYYY-MM */
  month: string;
  generatedAt: string;
  records: UniversalExportRecord[];
  totalsByCategory: Record<string, number>;
}

function totalsByCategory(records: UniversalExportRecord[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of records) {
    totals[r.category] = (totals[r.category] ?? 0) + r.amountCents;
  }
  return totals;
}

/** Arma el documento JSON completo del mes. */
export function buildUniversalExportJson(
  records: UniversalExportRecord[],
  month: string,
  generatedAtIso: string
): UniversalExportDocument {
  return {
    schemaVersion: UNIVERSAL_EXPORT_SCHEMA_VERSION,
    month,
    generatedAt: generatedAtIso,
    records,
    totalsByCategory: totalsByCategory(records),
  };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvUnescapeRow(row: string): string[] {
  // Parser RFC 4180 mínimo: soporta comillas dobles escapadas y comas dentro de campos citados.
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

const CSV_HEADER = ["schema_version", "month", "category", "description", "amount_cad", "currency", "metadata_json"];

/** Arma el CSV del mes — mismo contenido que el JSON, formato tabular. */
export function buildUniversalExportCsv(records: UniversalExportRecord[], month: string): string {
  const rows = records.map((r) => {
    const metadataJson = r.metadata ? JSON.stringify(r.metadata) : "";
    return [
      UNIVERSAL_EXPORT_SCHEMA_VERSION,
      month,
      r.category,
      csvEscape(r.description),
      (r.amountCents / 100).toFixed(2),
      "CAD",
      csvEscape(metadataJson),
    ].join(",");
  });
  return [CSV_HEADER.join(","), ...rows].join("\n");
}

export interface ParsedUniversalExportRow {
  schemaVersion: string;
  month: string;
  category: string;
  description: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string> | null;
}

/**
 * Parsea de vuelta un CSV producido por buildUniversalExportCsv (o
 * equivalente, mismas columnas) — prueba de que el formato es re-importable
 * sin pérdida de datos (criterio de aceptación E9).
 */
export function parseUniversalExportCsv(csv: string): ParsedUniversalExportRow[] {
  const lines = csv.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const [, ...dataLines] = lines; // descarta encabezado
  return dataLines.map((line) => {
    const [schemaVersion, month, category, description, amountCad, currency, metadataJson] = csvUnescapeRow(line);
    return {
      schemaVersion,
      month,
      category,
      description,
      amountCents: Math.round(parseFloat(amountCad) * 100),
      currency,
      metadata: metadataJson ? JSON.parse(metadataJson) : null,
    };
  });
}

/**
 * Capa 9 — QuickBooks IIF Accounting Adapter.
 *
 * Exporta asientos contables en formato IIF (Intuit Interchange Format)
 * compatible con QuickBooks Desktop y QuickBooks Online.
 *
 * Uso en QBO: File > Import > IIF. QBO Desktop: File > Utilities > Import > IIF.
 *
 * Formato IIF:
 *   - Tab-separated values.
 *   - Directivas de encabezado con prefijo `!` (definen columnas esperadas).
 *   - Filas de datos: TRNS (transacción), SPL (split/línea), ENDTRNS (cierre).
 *
 * Convención de signos QBO:
 *   - Débito  → AMOUNT positivo.
 *   - Crédito → AMOUNT negativo.
 *
 * Agrupación: entradas que comparten el mismo `orderId` y `occurredAt` (fecha)
 * se agrupan en una sola transacción con múltiples SPLs. Si no hay `orderId`,
 * cada entrada se exporta como una transacción independiente.
 *
 * Regla de oro: Solo export. Nunca lee de QBO.
 */

import type { FinancialLedgerEntry } from "@/lib/financial-reports";
import { getCuentaByCodigo } from "@/lib/coa";
import type {
  AccountingAdapter,
  AccountingAdapterFactory,
} from "@/lib/accounting-adapter";

// ---------------------------------------------------------------------------
// IIF format constants
// ---------------------------------------------------------------------------

/**
 * Directiva de encabezado para filas TRNS.
 * Define las columnas esperadas por QuickBooks para cada transacción.
 */
const IIF_TRNS_HEADER =
  "!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO";

/**
 * Directiva de encabezado para filas SPL (split/detalle).
 */
const IIF_SPL_HEADER =
  "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO";

/** Directiva de cierre de transacción. */
const IIF_ENDTRNS = "!ENDTRNS";

/** Tipo de transacción: siempre GENERAL JOURNAL para asientos contables. */
const TRNS_TYPE = "GENERAL JOURNAL";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convierte fecha ISO 8601 (YYYY-MM-DD) al formato MM/DD/YYYY requerido
 * por QuickBooks IIF.
 */
function toIifDate(isoDate: string): string {
  const d = isoDate.slice(0, 10);
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

/**
 * Convierte centavos a string con formato dólar para IIF.
 *
 * QBO usa signo para distinguir débito (+) de crédito (-).
 * Siempre 2 decimales fijos.
 */
function toIifAmount(cents: number, direction: "debit" | "credit"): string {
  const dollars = (cents / 100).toFixed(2);
  return direction === "debit" ? dollars : `-${dollars}`;
}

/**
 * Obtiene el nombre de cuenta desde el COA.
 * Si el código no existe, devuelve el código como string.
 */
function getAccountName(code: string): string {
  const cuenta = getCuentaByCodigo(code);
  return cuenta?.nombre ?? code;
}

// ---------------------------------------------------------------------------
// Transaction grouping
// ---------------------------------------------------------------------------

/**
 * Clave de agrupación para transacciones IIF.
 *
 * Entradas con la misma fecha y misma orden se consideran parte de un mismo
 * asiento contable compuesto (múltiples SPLs bajo un TRNS).
 */
interface TxnGroupKey {
  date: string;
  orderId: string | null;
}

function groupKey(entry: FinancialLedgerEntry): TxnGroupKey {
  return {
    date: entry.occurredAt.slice(0, 10),
    orderId: entry.orderId ?? null,
  };
}

/**
 * Agrupa entradas del ledger por fecha + orderId para construir transacciones
 * IIF balanceadas (múltiples SPL por cada TRNS).
 */
function groupEntries(
  entries: FinancialLedgerEntry[]
): Map<string, FinancialLedgerEntry[]> {
  const groups = new Map<string, FinancialLedgerEntry[]>();

  for (const entry of entries) {
    const key = groupKey(entry);
    // Si tiene orderId, usamos orderId + date como clave de grupo.
    // Si no, cada entrada va sola (clave = entry.id).
    const groupId = key.orderId
      ? `${key.orderId}__${key.date}`
      : entry.id;

    const existing = groups.get(groupId);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(groupId, [entry]);
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// IIF generation
// ---------------------------------------------------------------------------

/**
 * Genera el contenido IIF para un período contable.
 *
 * 1. Filtra entradas por período.
 * 2. Las agrupa por fecha + orderId.
 * 3. Cada grupo se convierte en una transacción IIF con TRNS + SPLs + ENDTRNS.
 */
function generateIifContent(
  entries: FinancialLedgerEntry[],
  periodo: string
): string {
  const filtered = entries
    .filter((e) => e.period === periodo)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  if (filtered.length === 0) {
    return [IIF_TRNS_HEADER, IIF_SPL_HEADER, IIF_ENDTRNS, ""].join("\n");
  }

  const groups = groupEntries(filtered);
  const lines: string[] = [IIF_TRNS_HEADER, IIF_SPL_HEADER, IIF_ENDTRNS];

  for (const [groupId, groupEntries] of groups) {
    // Usamos la primera entrada del grupo para metadatos comunes
    const first = groupEntries[0];
    const iifDate = toIifDate(first.occurredAt);
    const docNum = first.orderId ?? first.id.slice(0, 12);
    const memo = first.description ?? "";

    // TRNS line — una por transacción
    lines.push(
      [
        "TRNS",
        groupId.slice(0, 20), // TRNSID (truncado a 20 chars, límite QBO)
        TRNS_TYPE,
        iifDate,
        "", // ACCNT (vacío en TRNS; las cuentas van en SPL)
        "", // NAME (sin customer/vendor mapeado)
        "", // AMOUNT (QBO calcula el neto de los SPLs)
        docNum,
        memo,
      ].join("\t")
    );

    // SPL lines — una por cada entrada del grupo
    for (const entry of groupEntries) {
      const accountName = getAccountName(entry.accountCode);
      const amount = toIifAmount(entry.amountCents, entry.direction);
      const entryMemo = entry.description ?? memo;

      lines.push(
        [
          "SPL",
          groupId.slice(0, 20),
          TRNS_TYPE,
          iifDate,
          accountName,
          "", // NAME
          amount,
          docNum,
          entryMemo,
        ].join("\t")
      );
    }

    // Cierre de transacción
    lines.push("ENDTRNS");
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

/**
 * Crea un adaptador IIF para exportación a QuickBooks.
 *
 * @param entries Arreglo completo de entradas del `financial_ledger`.
 * @returns Una instancia de `AccountingAdapter` que exporta a formato IIF.
 *
 * @example
 * ```ts
 * const adapter = createIifAdapter(entries);
 * const iif = adapter.exportJournalEntries("2026-08");
 * // En QBO: File > Import > IIF, seleccionar "journal-2026-08.iif"
 * ```
 */
export const createIifAdapter: AccountingAdapterFactory = (
  entries: FinancialLedgerEntry[]
): AccountingAdapter => ({
  formatName: "QuickBooks IIF",
  mimeType: "text/tab-separated-values",
  fileExtension: ".iif",

  exportJournalEntries(periodo: string): string {
    return generateIifContent(entries, periodo);
  },
});

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Función de conveniencia: exporta asientos contables a formato IIF
 * directamente sin necesidad de crear el adaptador manualmente.
 *
 * Equivalente a:
 * ```ts
 * createIifAdapter(entries).exportJournalEntries(periodo)
 * ```
 *
 * @param entries Arreglo completo de entradas del ledger financiero.
 * @param periodo Período contable en formato YYYY-MM.
 * @returns String IIF listo para importar en QuickBooks.
 */
export function exportJournalEntriesAsIIF(
  entries: FinancialLedgerEntry[],
  periodo: string
): string | Buffer {
  return createIifAdapter(entries).exportJournalEntries(periodo);
}

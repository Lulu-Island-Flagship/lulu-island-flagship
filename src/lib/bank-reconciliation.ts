/**
 * Capa 7 — Bank Reconciliation: Conciliación Bancaria.
 *
 * Automatiza el proceso mensual de conciliación entre el extracto bancario
 * (RBC, TD, BMO) y el Financial Ledger (Capa 0).
 *
 * Ciclo de conciliación:
 *   1. Parsear CSV del banco → transacciones normalizadas
 *   2. Sugerir matches entre banco y ledger (monto + fecha + referencia)
 *   3. Confirmar conciliación manual → genera JE de conciliación
 *   4. Reportar estado: % conciliado, partidas no conciliadas, divergencias
 *
 * Nota: El asiento de conciliación (bank_reconciled) es un marcador contable
 * que NO afecta el saldo neto (débito y crédito a EFECTIVO por el mismo monto).
 * Sirve para trazabilidad: deja registro de que una transacción del ledger fue
 * verificada contra el extracto bancario.
 *
 * Todas las funciones son puras: no tocan la base de datos. El caller es
 * responsable de leer/escribir y de ejecutar las inserciones en el ledger.
 */

import { z } from "zod";
import {
  generateJournalEntry,
  CHART_OF_ACCOUNTS,
  type BusinessEvent,
  type JournalEntryRow,
} from "@/lib/financial-ledger";

// =========================================================================
// Constants
// =========================================================================

/** Formatos de banco soportados para parseo CSV. */
export const SUPPORTED_BANK_FORMATS = ["RBC", "TD", "BMO"] as const;
export type BankFormat = (typeof SUPPORTED_BANK_FORMATS)[number];

/** Máxima diferencia en centavos para considerar un match automático. */
export const MATCH_AMOUNT_TOLERANCE_CENTS = 5;

/** Ventana de días para buscar matches por fecha (± N días). */
export const MATCH_DATE_WINDOW_DAYS = 3;

// =========================================================================
// Domain types
// =========================================================================

/**
 * Transacción bancaria normalizada desde un CSV de extracto.
 */
export interface BankTransaction {
  /** ID único generado al parsear (hash del contenido o UUID) */
  bank_tx_id: string;
  /** Fecha de la transacción según el banco (ISO 8601) */
  fecha: string;
  /** Descripción de la transacción en el extracto */
  descripcion: string;
  /** Monto en centavos: positivo = crédito/depósito, negativo = débito/retiro */
  monto: number;
  /** Banco origen del extracto */
  banco: BankFormat;
  /** Referencia adicional: número de cheque, ID de transferencia, etc. */
  referencia: string | null;
  /** Tipo de transacción: CREDIT (entrada de dinero) o DEBIT (salida de dinero) */
  tipo: "CREDIT" | "DEBIT";
}

/**
 * Fila del Financial Ledger relevante para conciliación bancaria.
 * Solo se necesitan los campos que permiten cruzar con el banco.
 */
export interface LedgerEntryForReconciliation {
  /** ID de la fila en financial_ledger (ledger_id) */
  ledger_id: string;
  /** Fecha de la transacción en el ledger (ISO 8601) */
  fecha: string;
  /** Monto en centavos (siempre positivo en el ledger) */
  monto: number;
  /** Cuenta de débito (si existe) */
  cuenta_debito: string | null;
  /** Cuenta de crédito (si existe) */
  cuenta_credito: string | null;
  /** Descripción de la transacción */
  descripcion: string;
  /** Referencia externa (ej. payment intent de Stripe) */
  referencia_externa: string | null;
}

/**
 * Match sugerido entre una transacción bancaria y una entrada del ledger.
 */
export interface ReconciliationMatch {
  /** ID único del match */
  match_id: string;
  /** Transacción del banco */
  bank_tx: BankTransaction;
  /** Entrada del ledger que hace match */
  ledger_entry: LedgerEntryForReconciliation;
  /** Diferencia en centavos entre el monto del banco y el ledger (absoluta) */
  diferencia_cents: number;
  /** Diferencia en días entre las fechas */
  diferencia_dias: number;
  /** Nivel de confianza del match (0-1) */
  confianza: number;
}

/**
 * Registro de conciliación confirmada.
 */
export interface ReconciliationRecord {
  /** ID del ledger reconciliado */
  ledger_id: string;
  /** ID de la transacción bancaria */
  bank_tx_id: string;
  /** Admin que ejecutó la conciliación */
  admin_id: string;
  /** Fecha en que se ejecutó la conciliación (ISO 8601) */
  fecha_conciliacion: string;
  /** Estado: "conciliado" */
  estado: "conciliado";
}

/**
 * Resumen del estado de conciliación para un período.
 */
export interface ReconciliationStatus {
  /** Período contable YYYY-MM */
  periodo: string;
  /** Total de transacciones en el ledger del período */
  total_ledger_items: number;
  /** Transacciones del ledger ya conciliadas */
  conciliated_items: number;
  /** Transacciones del ledger NO conciliadas */
  unreconciled_items: number;
  /** Porcentaje de conciliación (0-100) */
  porcentaje_conciliado: number;
  /** Total de divergencias encontradas (matches con diferencia > tolerancia) */
  divergencias_count: number;
  /** Suma de divergencias en centavos (valor absoluto) */
  divergencias_total_cents: number;
}

// =========================================================================
// Zod schemas
// =========================================================================

export const BankTransactionSchema = z.object({
  bank_tx_id: z.string().min(1),
  fecha: z.string().min(1),
  descripcion: z.string(),
  monto: z.number().int(),
  banco: z.enum(SUPPORTED_BANK_FORMATS),
  referencia: z.string().nullable(),
  tipo: z.enum(["CREDIT", "DEBIT"]),
});

export const ReconciliationMatchSchema = z.object({
  match_id: z.string().min(1),
  bank_tx: BankTransactionSchema,
  ledger_entry: z.object({
    ledger_id: z.string().min(1),
    fecha: z.string().min(1),
    monto: z.number().int(),
    cuenta_debito: z.string().nullable(),
    cuenta_credito: z.string().nullable(),
    descripcion: z.string(),
    referencia_externa: z.string().nullable(),
  }),
  diferencia_cents: z.number().int().nonnegative(),
  diferencia_dias: z.number().int().nonnegative(),
  confianza: z.number().min(0).max(1),
});

// =========================================================================
// CSV Parsing
// =========================================================================

/**
 * Parsea el contenido CSV de un extracto bancario y devuelve
 * transacciones normalizadas.
 *
 * Formatos soportados:
 *  - RBC: "Account Type,Account Number,Transaction Date,Cheque Number,Description 1,Description 2,CAD$,USD$"
 *  - TD:  "Date,Description,Debit,Credit,Balance"
 *  - BMO: "Transaction Type,Date,Description,Amount,Balance"
 *
 * @param csvContent — Contenido completo del archivo CSV como string.
 * @param bankFormat — Formato del banco ("RBC", "TD", "BMO").
 * @returns Array de BankTransaction normalizadas.
 * @throws {Error} si el formato no es soportado o el CSV es inválido.
 */
export function parseBankCsv(
  csvContent: string,
  bankFormat: BankFormat,
): BankTransaction[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new Error("CSV vacío o sin datos (se esperaba al menos header + 1 fila)");
  }

  switch (bankFormat) {
    case "RBC":
      return parseRbc(lines);
    case "TD":
      return parseTd(lines);
    case "BMO":
      return parseBmo(lines);
    default:
      throw new Error(`Formato de banco no soportado: ${bankFormat}`);
  }
}

/**
 * Parsea CSV de RBC.
 *
 * Columnas esperadas:
 *   "Account Type","Account Number","Transaction Date","Cheque Number",
 *   "Description 1","Description 2","CAD$","USD$"
 *
 * El monto en CAD$ puede ser positivo (crédito) o negativo (débito).
 */
function parseRbc(lines: string[]): BankTransaction[] {
  // Saltar header
  const dataLines = lines.slice(1);
  const transactions: BankTransaction[] = [];

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 8) continue;

    // RBC: Transaction Date en col 2, Description 1 en col 4, Description 2 en col 5, CAD$ en col 6
    const rawDate = cols[2]?.replace(/"/g, "").trim();
    const desc1 = cols[4]?.replace(/"/g, "").trim() ?? "";
    const desc2 = cols[5]?.replace(/"/g, "").trim() ?? "";
    const amountStr = cols[6]?.replace(/"/g, "").replace(/,/g, "").trim();
    const chequeNum = cols[3]?.replace(/"/g, "").trim();

    if (!rawDate || !amountStr) continue;

    const fecha = parseDate(rawDate);
    const monto = parseAmount(amountStr);
    const descripcion = [desc1, desc2].filter(Boolean).join(" — ") || "Sin descripción";

    transactions.push(
      BankTransactionSchema.parse({
        bank_tx_id: generateTxId("RBC", rawDate, amountStr, descripcion),
        fecha,
        descripcion,
        monto,
        banco: "RBC",
        referencia: chequeNum || null,
      }),
    );
  }

  return transactions;
}

/**
 * Parsea CSV de TD.
 *
 * Columnas esperadas:
 *   "Date","Description","Debit","Credit","Balance"
 *
 * Débito: monto negativo (dinero que sale).
 * Crédito: monto positivo (dinero que entra).
 */
function parseTd(lines: string[]): BankTransaction[] {
  const dataLines = lines.slice(1);
  const transactions: BankTransaction[] = [];

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;

    // TD: Date en col 0, Description en col 1, Debit en col 2, Credit en col 3
    const rawDate = cols[0]?.replace(/"/g, "").trim();
    const descripcion = cols[1]?.replace(/"/g, "").trim() ?? "Sin descripción";
    const debitStr = cols[2]?.replace(/"/g, "").replace(/,/g, "").trim();
    const creditStr = cols[3]?.replace(/"/g, "").replace(/,/g, "").trim();

    if (!rawDate) continue;

    const fecha = parseDate(rawDate);

    // Débito es dinero que sale (negativo), crédito es dinero que entra (positivo)
    let monto = 0;
    if (creditStr && creditStr !== "0" && creditStr !== "") {
      monto = parseAmount(creditStr);
    } else if (debitStr && debitStr !== "0" && debitStr !== "") {
      monto = -parseAmount(debitStr);
    } else {
      continue;
    }

    transactions.push(
      BankTransactionSchema.parse({
        bank_tx_id: generateTxId("TD", rawDate, String(monto), descripcion),
        fecha,
        descripcion,
        monto,
        banco: "TD",
        referencia: null,
      }),
    );
  }

  return transactions;
}

/**
 * Parsea CSV de BMO.
 *
 * Columnas esperadas:
 *   "Transaction Type","Date","Description","Amount","Balance"
 *
 * Amount: positivo = crédito, negativo = débito.
 */
function parseBmo(lines: string[]): BankTransaction[] {
  const dataLines = lines.slice(1);
  const transactions: BankTransaction[] = [];

  for (const line of dataLines) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) continue;

    // BMO: Transaction Type en col 0, Date en col 1, Description en col 2, Amount en col 3
    const rawDate = cols[1]?.replace(/"/g, "").trim();
    const descripcion = cols[2]?.replace(/"/g, "").trim() ?? "Sin descripción";
    const amountStr = cols[3]?.replace(/"/g, "").replace(/,/g, "").trim();

    if (!rawDate || !amountStr) continue;

    const fecha = parseDate(rawDate);
    const monto = parseAmount(amountStr);

    transactions.push(
      BankTransactionSchema.parse({
        bank_tx_id: generateTxId("BMO", rawDate, amountStr, descripcion),
        fecha,
        descripcion,
        monto,
        banco: "BMO",
        referencia: null,
      }),
    );
  }

  return transactions;
}

// =========================================================================
// CSV parsing helpers
// =========================================================================

/**
 * Parsea una línea CSV respetando campos entrecomillados.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Convierte una fecha en formato banco a ISO 8601 (YYYY-MM-DD).
 * Soporta: MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY, YYYYMMDD
 */
function parseDate(raw: string): string {
  // Ya está en ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Formato YYYYMMDD (BMO a veces)
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }

  // MM/DD/YYYY o DD/MM/YYYY → asumimos MM/DD/YYYY (formato canadiense bancario)
  const parts = raw.split(/[/-]/);
  if (parts.length === 3) {
    const month = parts[0].padStart(2, "0");
    const day = parts[1].padStart(2, "0");
    let year = parts[2];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // Fallback: devolver tal cual
  return raw;
}

/**
 * Convierte un string de monto bancario a centavos enteros.
 * Soporta formatos: "1,234.56", "-500.00", "1234.56", "1234"
 */
function parseAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  const floatVal = parseFloat(cleaned);
  if (isNaN(floatVal)) return 0;
  return Math.round(floatVal * 100);
}

/**
 * Genera un ID único para una transacción bancaria basado en su contenido.
 * Usa un hash simple para deduplicación.
 */
function generateTxId(
  banco: string,
  fecha: string,
  monto: string,
  descripcion: string,
): string {
  // Simple hash: concatenar y tomar los primeros 32 caracteres como "ID"
  const raw = `${banco}|${fecha}|${monto}|${descripcion}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  const hexHash = Math.abs(hash).toString(16).padStart(8, "0");
  return `btx_${banco.toLowerCase()}_${hexHash}`;
}

// =========================================================================
// Match suggestion
// =========================================================================

/**
 * Sugiere matches entre transacciones bancarias y entradas del Financial Ledger.
 *
 * Algoritmo:
 *   1. Para cada transacción bancaria, busca en el ledger entradas que
 *      coincidan por monto (con tolerancia) y fecha (dentro de ventana).
 *   2. Calcula un puntaje de confianza basado en:
 *      - Proximidad exacta del monto (peso 0.5)
 *      - Proximidad de fecha (peso 0.3)
 *      - Similitud de texto en descripción/referencia (peso 0.2)
 *   3. Filtra matches con confianza < 0.6 (baja calidad).
 *   4. Ordena por confianza descendente.
 *
 * @param bankTransactions — Transacciones del extracto bancario.
 * @param ledgerEntries — Entradas del financial_ledger del período.
 * @returns Array de ReconciliationMatch ordenado por confianza descendente.
 */
export function suggestMatches(
  bankTransactions: BankTransaction[],
  ledgerEntries: LedgerEntryForReconciliation[],
): ReconciliationMatch[] {
  const matches: ReconciliationMatch[] = [];

  for (const bankTx of bankTransactions) {
    for (const ledger of ledgerEntries) {
      // El monto en el ledger siempre es positivo; el banco puede ser negativo (débito)
      const bankAbsAmount = Math.abs(bankTx.monto);
      const diferenciaCents = Math.abs(bankAbsAmount - ledger.monto);

      // Tolerancia de monto
      if (diferenciaCents > MATCH_AMOUNT_TOLERANCE_CENTS) continue;

      // Diferencia de fechas
      const fechaBank = new Date(`${bankTx.fecha}T00:00:00.000Z`);
      const fechaLedger = new Date(`${ledger.fecha.slice(0, 10)}T00:00:00.000Z`);
      const diferenciaDias = Math.abs(
        Math.round(
          (fechaBank.getTime() - fechaLedger.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );

      // Ventana de fecha
      if (diferenciaDias > MATCH_DATE_WINDOW_DAYS) continue;

      // Similitud de texto
      const textSimilarity = computeTextSimilarity(
        bankTx.descripcion,
        ledger.descripcion + (ledger.referencia_externa ?? ""),
      );

      // Confianza compuesta (0-1)
      const amountConfidence =
        diferenciaCents === 0 ? 1.0 : 1.0 - diferenciaCents / MATCH_AMOUNT_TOLERANCE_CENTS;
      const dateConfidence =
        diferenciaDias === 0 ? 1.0 : 1.0 - diferenciaDias / MATCH_DATE_WINDOW_DAYS;
      const confianza =
        amountConfidence * 0.5 + dateConfidence * 0.3 + textSimilarity * 0.2;

      // Umbral mínimo de confianza
      if (confianza < 0.6) continue;

      matches.push(
        ReconciliationMatchSchema.parse({
          match_id: crypto.randomUUID(),
          bank_tx: bankTx,
          ledger_entry: ledger,
          diferencia_cents: diferenciaCents,
          diferencia_dias: diferenciaDias,
          confianza: Math.round(confianza * 1000) / 1000,
        }),
      );
    }
  }

  // Ordenar por confianza descendente, luego por diferencia de monto ascendente
  return matches.sort((a, b) => {
    if (b.confianza !== a.confianza) return b.confianza - a.confianza;
    return a.diferencia_cents - b.diferencia_cents;
  });
}

/**
 * Sugiere matches para conciliación bancaria en un período contable,
 * filtrando las entradas del ledger a aquellas que involucran la cuenta
 * de efectivo (1-1000), que es la que debe coincidir con el extracto bancario.
 *
 * Cruza transacciones bancarias contra entradas del financial_ledger
 * por monto + fecha dentro de una ventana de ±2 días.
 *
 * @param periodo — Período contable YYYY-MM.
 * @param bankTransactions — Transacciones del extracto bancario.
 * @param ledgerEntries — Todas las entradas del ledger del período (se filtran a cuenta 1-1000 internamente).
 * @returns Array de ReconciliationMatch ordenado por confianza descendente.
 */
export function suggestMatchesForPeriod(
  periodo: string,
  bankTransactions: BankTransaction[],
  ledgerEntries: LedgerEntryForReconciliation[],
): ReconciliationMatch[] {
  // Filtrar solo entradas del ledger que involucran la cuenta de efectivo (1-1000)
  // — son las únicas que deben aparecer en el extracto bancario.
  const cashLedgerEntries = ledgerEntries.filter(
    (entry) =>
      entry.cuenta_debito === CHART_OF_ACCOUNTS.EFECTIVO ||
      entry.cuenta_credito === CHART_OF_ACCOUNTS.EFECTIVO,
  );

  // Delegar al algoritmo de matching existente
  return suggestMatches(bankTransactions, cashLedgerEntries);
}

/**
 * Calcula similitud simple entre dos strings basada en tokens compartidos.
 * Retorna un valor entre 0 (sin similitud) y 1 (idénticos).
 */
function computeTextSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/[\s,._\-:;()]+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/[\s,._\-:;()]+/).filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  return intersection / Math.max(tokensA.size, tokensB.size);
}

// =========================================================================
// Reconciliation actions
// =========================================================================

/**
 * Confirma la conciliación de una entrada del ledger con una transacción
 * bancaria.
 *
 * Genera un ReconciliationRecord y opcionalmente el asiento contable
 * de conciliación (bank_reconciled).
 *
 * @param ledgerId — ID del ledger a conciliar.
 * @param bankTxId — ID de la transacción bancaria.
 * @param adminId — UUID del admin que ejecuta la conciliación.
 * @returns ReconciliationRecord confirmado.
 */
export function reconcileTransaction(
  ledgerId: string,
  bankTxId: string,
  adminId: string,
): ReconciliationRecord {
  return {
    ledger_id: ledgerId,
    bank_tx_id: bankTxId,
    admin_id: adminId,
    fecha_conciliacion: new Date().toISOString(),
    estado: "conciliado",
  };
}

/**
 * Genera el asiento contable de conciliación bancaria.
 *
 * Este es un asiento de marcador: débito y crédito a EFECTIVO por el
 * mismo monto. No afecta el saldo neto, solo deja trazabilidad de que
 * la transacción fue verificada contra el extracto bancario.
 *
 * @param ledgerEntry — Entrada del ledger que se está conciliando.
 * @param adminId — UUID del admin.
 * @returns Array de JournalEntryRow (2 filas).
 */
export function generateReconciliationJournalEntry(
  ledgerEntry: LedgerEntryForReconciliation,
  adminId: string,
): JournalEntryRow[] {
  const event: BusinessEvent = {
    event_id: crypto.randomUUID(),
    event_type: "bank_reconciled",
    order_id: null,
    user_id: adminId,
    amount_cents: ledgerEntry.monto,
    currency: "CAD",
    processor: "internal",
    external_reference: ledgerEntry.ledger_id,
    occurred_at: new Date().toISOString(),
    metadata: {
      ledger_id: ledgerEntry.ledger_id,
      ledger_descripcion: ledgerEntry.descripcion,
    },
  };

  return generateJournalEntry(event);
}

// =========================================================================
// Unreconciled items
// =========================================================================

/**
 * Filtra las entradas del ledger que NO han sido conciliadas.
 *
 * @param ledgerEntries — Todas las entradas del ledger del período.
 * @param reconciledLedgerIds — Set de ledger_id ya conciliados.
 * @returns Entradas del ledger no conciliadas.
 */
export function getUnreconciledItems(
  ledgerEntries: LedgerEntryForReconciliation[],
  reconciledLedgerIds: Set<string>,
): LedgerEntryForReconciliation[] {
  return ledgerEntries.filter((entry) => !reconciledLedgerIds.has(entry.ledger_id));
}

// =========================================================================
// Reconciliation status
// =========================================================================

/**
 * Calcula el estado de conciliación para un período contable.
 *
 * @param periodo — Período contable YYYY-MM.
 * @param ledgerEntries — Todas las entradas del ledger del período.
 * @param reconciledLedgerIds — Set de ledger_id ya conciliados.
 * @param matchDivergences — Lista de matches con divergencias > tolerancia.
 * @returns ReconciliationStatus con porcentajes y métricas.
 */
export function getReconciliationStatus(
  periodo: string,
  ledgerEntries: LedgerEntryForReconciliation[],
  reconciledLedgerIds: Set<string>,
  matchDivergences?: ReconciliationMatch[],
): ReconciliationStatus {
  const totalItems = ledgerEntries.length;
  const conciliatedItems = ledgerEntries.filter((e) =>
    reconciledLedgerIds.has(e.ledger_id),
  ).length;
  const unreconciledItems = totalItems - conciliatedItems;
  const porcentaje = totalItems > 0
    ? Math.round((conciliatedItems / totalItems) * 10000) / 100
    : 100;

  const divergencias = matchDivergences ?? [];
  const divergenciasCount = divergencias.length;
  const divergenciasTotalCents = divergencias.reduce(
    (sum, d) => sum + d.diferencia_cents,
    0,
  );

  return {
    periodo,
    total_ledger_items: totalItems,
    conciliated_items: conciliatedItems,
    unreconciled_items: unreconciledItems,
    porcentaje_conciliado: porcentaje,
    divergencias_count: divergenciasCount,
    divergencias_total_cents: divergenciasTotalCents,
  };
}

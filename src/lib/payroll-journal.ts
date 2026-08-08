/**
 * v8.4 Capa 4 del Financial Core — Payroll Journal Entry Generator.
 *
 * Genera el asiento contable (Journal Entry) para un ciclo de nómina cerrado.
 * Produce filas de partida doble compatibles con la tabla `financial_ledger`.
 *
 * ASIENTO (7 filas: 2 débitos + 5 créditos):
 *
 *   DÉBITOS:
 *     1. GASTO_NOMINA (6-6100)              = total_bruto
 *     2. GASTO_CARGAS_PATRONALES (6-6200)    = total_employer_contributions
 *
 *   CRÉDITOS:
 *     3. EFECTIVO (1-1000)                  = total_neto
 *     4. CPP_POR_PAGAR (2-2200)              = total_cpp
 *     5. EI_POR_PAGAR (2-2300)               = total_ei
 *     6. IMPUESTOS_RETENIDOS_POR_PAGAR (2-2400) = total_tax
 *     7. WORKSAFEBC_POR_PAGAR (2-2500)        = total_worksafebc
 *
 * INVARIANTE CONTABLE:
 *   SUM(débitos) = total_bruto + total_employer_contributions
 *   SUM(créditos) = total_neto + total_cpp + total_ei + total_tax + total_worksafebc
 *   Ambos lados siempre son iguales (verificado con throw en runtime).
 *
 * Extraído de payroll-engine.ts (Paso C — god-object decomposition).
 */

import {
  CHART_OF_ACCOUNTS,
  type LedgerEntryStatus,
  computeRowHash,
  type HashableRow,
} from "./financial-ledger";

import {
  PAYROLL_CHART_OF_ACCOUNTS,
  type PayrollCuentaContable,
} from "./payroll-chart";

// =========================================================================
// Payroll Journal — tipos
// =========================================================================

/**
 * Evento de negocio para registrar un ciclo de nómina en el Financial Ledger.
 *
 * El payroll_disbursement dispara un asiento contable de partida doble
 * multi-fila que registra:
 *   - Gasto de nómina (débito)
 *   - Gasto de cargas patronales (débito)
 *   - Efectivo / Banco (crédito por neto pagado a empleados)
 *   - Pasivos por remesar (crédito: CPP, EI, Tax, WorkSafeBC, Vacation Pay)
 *
 * El evento se emite al transicionar el ciclo a CERRADO.
 */
export interface PayrollDisbursementEvent {
  event_id: string;
  ciclo_id: string;
  ciclo_quincena: string;
  occurred_at: string;
}

/**
 * Una fila del Journal Entry de nómina.
 *
 * Extiende el concepto de JournalEntryRow del financial-ledger con cuentas
 * de nómina (2-2xxx, 6-1xxx). Las filas generadas son compatibles con la
 * tabla financial_ledger (misma estructura base).
 */
export interface PayrollJournalRow {
  ledger_id: string;
  event_id: string;
  event_type: "payroll_disbursement";
  timestamp: string;
  periodo_contable: string;
  cuenta_debito: PayrollCuentaContable | null;
  cuenta_credito: PayrollCuentaContable | null;
  monto: number;
  moneda: "CAD";
  descripcion: string;
  referencia: Record<string, unknown>;
  estado: LedgerEntryStatus;
  hash_sha256: string;
  creado_por: string;
}

/**
 * Datos agregados de un ciclo para generar el JE.
 *
 * El caller (ruta/cron que cierra el ciclo) obtiene estos totales de la
 * tabla payroll_ciclo (ya actualizada con updateCycleTotals) y las líneas
 * de payroll_linea.
 */
export interface PayrollJournalInput {
  /** Total bruto del ciclo (suma de gross de todas las líneas). */
  total_bruto: number;

  /** Total CPP empleado + empleador. */
  total_cpp: number;

  /** Total EI empleado + empleador. */
  total_ei: number;

  /** Total impuestos retenidos (federal + provincial). */
  total_tax: number;

  /** Total WorkSafeBC (solo empleador). */
  total_worksafebc: number;

  /** Total Vacation Pay accrual del ciclo. */
  total_vacation_pay: number;

  /** Total neto a pagar a empleados. */
  total_neto: number;

  /** Total cargas patronales (CPP employer + EI employer + WorkSafeBC). */
  total_employer_contributions: number;

  /** ID del ciclo de nómina. */
  ciclo_id: string;

  /** Quincena del ciclo (ej. "2026-08 Q1"). */
  quincena: string;
}

// =========================================================================
// generatePayrollJournalEntry()
// =========================================================================

/**
 * Genera el asiento contable (Journal Entry) para un ciclo de nómina.
 *
 * PRODUCE 7 filas (2 débitos, 5 créditos) que garantizan partida doble:
 *
 *   DÉBITOS:
 *     1. GASTO_NOMINA (6-6100)              = total_bruto
 *     2. GASTO_CARGAS_PATRONALES (6-6200)    = total_employer_contributions
 *
 *   CRÉDITOS:
 *     3. EFECTIVO (1-1000)                  = total_neto
 *     4. CPP_POR_PAGAR (2-2200)              = total_cpp
 *     5. EI_POR_PAGAR (2-2300)               = total_ei
 *     6. IMPUESTOS_RETENIDOS_POR_PAGAR (2-2400) = total_tax
 *     7. WORKSAFEBC_POR_PAGAR (2-2500)        = total_worksafebc
 *
 * INVARIANTE CONTABLE:
 *   SUM(débitos) = total_bruto + total_employer_contributions
 *   SUM(créditos) = total_neto + total_cpp + total_ei + total_tax + total_worksafebc
 *   = total_bruto + total_employer_contributions ✓
 *
 * @param input — datos agregados del ciclo de nómina.
 * @param createdBy — quién genera el JE (user_id o "system").
 * @returns Array de 7 PayrollJournalRow (2 débitos + 5 créditos).
 * @throws {Error} si la invariante contable no se cumple.
 */
export function generatePayrollJournalEntry(
  input: PayrollJournalInput,
  createdBy: string = "system",
): PayrollJournalRow[] {
  const eventId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const periodo = timestamp.slice(0, 7); // YYYY-MM

  const referencia: Record<string, unknown> = {
    ciclo_id: input.ciclo_id,
    quincena: input.quincena,
    total_bruto: input.total_bruto,
    total_neto: input.total_neto,
    total_cpp: input.total_cpp,
    total_ei: input.total_ei,
    total_tax: input.total_tax,
    total_worksafebc: input.total_worksafebc,
    total_employer_contributions: input.total_employer_contributions,
    total_vacation_pay: input.total_vacation_pay,
  };

  const rows: Omit<PayrollJournalRow, "hash_sha256">[] = [];

  // ── DÉBITO 1: Gasto de Nómina (gross pay) ────────────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: PAYROLL_CHART_OF_ACCOUNTS.GASTO_NOMINA,
    cuenta_credito: null,
    monto: input.total_bruto,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — Gasto bruto [DÉBITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── DÉBITO 2: Gasto de Cargas Patronales ─────────────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: PAYROLL_CHART_OF_ACCOUNTS.GASTO_CARGAS_PATRONALES,
    cuenta_credito: null,
    monto: input.total_employer_contributions,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — Cargas patronales [DÉBITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── CRÉDITO 1: Efectivo (neto pagado a empleados) ────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: null,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    monto: input.total_neto,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — Neto pagado a empleados [CRÉDITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── CRÉDITO 2: CPP por Pagar ─────────────────────────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: null,
    cuenta_credito: PAYROLL_CHART_OF_ACCOUNTS.CPP_POR_PAGAR,
    monto: input.total_cpp,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — CPP por pagar a CRA [CRÉDITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── CRÉDITO 3: EI por Pagar ──────────────────────────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: null,
    cuenta_credito: PAYROLL_CHART_OF_ACCOUNTS.EI_POR_PAGAR,
    monto: input.total_ei,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — EI por pagar a CRA [CRÉDITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── CRÉDITO 4: Impuestos Retenidos por Pagar ─────────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: null,
    cuenta_credito: PAYROLL_CHART_OF_ACCOUNTS.IMPUESTOS_RETENIDOS_POR_PAGAR,
    monto: input.total_tax,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — Impuestos retenidos por pagar a CRA [CRÉDITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── CRÉDITO 5: WorkSafeBC por Pagar ──────────────────────────────────
  rows.push({
    ledger_id: ledgerId,
    event_id: eventId,
    event_type: "payroll_disbursement",
    timestamp,
    periodo_contable: periodo,
    cuenta_debito: null,
    cuenta_credito: PAYROLL_CHART_OF_ACCOUNTS.WORKSAFEBC_POR_PAGAR,
    monto: input.total_worksafebc,
    moneda: "CAD",
    descripcion: `Nómina ${input.quincena} — WorkSafeBC por pagar [CRÉDITO]`,
    referencia,
    estado: "confirmado",
    creado_por: createdBy,
  });

  // ── Verificar invariante contable ────────────────────────────────────
  const sumDebito = rows
    .filter((r) => r.cuenta_debito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  const sumCredito = rows
    .filter((r) => r.cuenta_credito !== null)
    .reduce((sum, r) => sum + r.monto, 0);

  if (sumDebito !== sumCredito) {
    throw new Error(
      `generatePayrollJournalEntry: invariante contable rota — ` +
        `SUM(débito)=${sumDebito} ≠ SUM(crédito)=${sumCredito}. ` +
        `ciclo=${input.quincena}, ledger_id=${ledgerId}. ` +
        `Verificar totales: bruto=${input.total_bruto}, ` +
        `employer=${input.total_employer_contributions}, ` +
        `neto=${input.total_neto}, cpp=${input.total_cpp}, ` +
        `ei=${input.total_ei}, tax=${input.total_tax}, wsbc=${input.total_worksafebc}`,
    );
  }

  // ── Calcular hash SHA-256 por fila ────────────────────────────────────
  // Reusa computeRowHash de financial-ledger — sin duplicar lógica.
  return rows.map((row) => ({
    ...row,
    hash_sha256: computeRowHash(row as HashableRow),
  }));
}

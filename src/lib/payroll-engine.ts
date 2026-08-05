/**
 * v8.4 Capa 4 del Financial Core — Payroll Engine.
 *
 * Orquesta el ciclo completo de nómina: creación del ciclo, cálculo de líneas
 * por empleado, state machine de aprobación, y generación del asiento contable
 * (Journal Entry) en el Financial Ledger.
 *
 * State Machine:
 *   CALCULANDO → APROBADO_ADMIN → CERRADO → REMESAS_ENVIADAS → PAGADO
 *
 *   - CALCULANDO:     ciclo creado, líneas en cálculo. Se pueden recalcular.
 *   - APROBADO_ADMIN: admin revisó y aprobó los montos. Líneas congeladas.
 *   - CERRADO:        ciclo cerrado contablemente. JE generado en ledger.
 *   - REMESAS_ENVIADAS:remesas a CRA (CPP, EI, Tax) enviadas.
 *   - PAGADO:         depósitos directos a empleados confirmados.
 *
 * Transiciones válidas (dirigidas, no arbitrarias):
 *   CALCULANDO     → APROBADO_ADMIN   (admin aprueba)
 *   APROBADO_ADMIN → CERRADO          (contabilidad cierra)
 *   CERRADO        → REMESAS_ENVIADAS (remesas CRA confirmadas)
 *   REMESAS_ENVIADAS → PAGADO         (direct deposit confirmado)
 *
 *   Reversiones permitidas (solo un paso atrás):
 *   APROBADO_ADMIN → CALCULANDO       (admin rechaza — recalcular)
 *
 * Interconexiones:
 *   payroll-engine.ts ──(importa)──→ payroll-calculator.ts
 *   payroll-engine.ts ──(importa)──→ payroll-line.ts
 *   payroll-engine.ts ──(importa)──→ financial-ledger.ts (tipos y cuentas)
 *   payroll-engine.ts ──(importado por)──→ pay-statement.ts
 */

import { z } from "zod";
import { createHash } from "node:crypto";

// import type { PayrollLineaRow } from "./payroll-line";
import type { PayrollCalculationResult } from "./payroll-calculator";

import {
  CHART_OF_ACCOUNTS,
  type CuentaContable,
  type LedgerEntryStatus,
} from "./financial-ledger";

// =========================================================================
// Payroll-specific Chart of Accounts extensions
// =========================================================================

/**
 * Cuentas contables para nómina — extienden el Chart of Accounts base.
 *
 * Pasivos (2xxx):
 *   - 2-2000: CPP por Pagar (employee + employer)
 *   - 2-3000: EI por Pagar (employee + employer)
 *   - 2-4000: Impuestos Retenidos por Pagar (federal + provincial)
 *   - 2-5000: WorkSafeBC por Pagar
 *   - 2-6000: Vacation Pay Acumulado (pasivo)
 *
 * Gastos (6xxx):
 *   - 6-1000: Gasto de Nómina (gross pay)
 *   - 6-2000: Gasto de Cargas Patronales (CPP employer + EI employer + WorkSafeBC)
 */
export const PAYROLL_CHART_OF_ACCOUNTS = {
  /** Pasivo — CPP por Pagar (employee + employer contributions pendientes de remesar a CRA). */
  CPP_POR_PAGAR: "2-2200",
  /** Pasivo — EI por Pagar (employee + employer premiums pendientes de remesar a CRA). */
  EI_POR_PAGAR: "2-2300",
  /** Pasivo — Impuestos Retenidos por Pagar (federal + provincial tax withholdings). */
  IMPUESTOS_RETENIDOS_POR_PAGAR: "2-2400",
  /** Pasivo — WorkSafeBC por Pagar (employer premium pendiente). */
  WORKSAFEBC_POR_PAGAR: "2-2500",
  /** Pasivo — Vacation Pay Acumulado (accrual pendiente de pago al empleado). */
  VACATION_PAY_POR_PAGAR: "2-2600",
  /** Gasto — Nómina bruta del período (gross pay a empleados). */
  GASTO_NOMINA: "6-6100",
  /** Gasto — Cargas Patronales (CPP employer + EI employer + WorkSafeBC). */
  GASTO_CARGAS_PATRONALES: "6-6200",
} as const;

/** Todas las cuentas contables (base + payroll). */
export type PayrollCuentaContable = CuentaContable | (typeof PAYROLL_CHART_OF_ACCOUNTS)[keyof typeof PAYROLL_CHART_OF_ACCOUNTS];

// =========================================================================
// Payroll Cycle — tipos y schema
// =========================================================================

/**
 * Estados del ciclo de nómina.
 *
 * La máquina de estados es dirigida: solo ciertas transiciones son válidas.
 * Ver `VALID_TRANSITIONS` para el mapa completo.
 */
export type PayrollCycleStatus =
  | "CALCULANDO"
  | "APROBADO_ADMIN"
  | "CERRADO"
  | "REMESAS_ENVIADAS"
  | "PAGADO";

/** Mapa de transiciones válidas entre estados. */
export const VALID_TRANSITIONS: Record<PayrollCycleStatus, PayrollCycleStatus[]> = {
  CALCULANDO: ["APROBADO_ADMIN"],
  APROBADO_ADMIN: ["CERRADO", "CALCULANDO"], // CALCULANDO = admin rechaza
  CERRADO: ["REMESAS_ENVIADAS"],
  REMESAS_ENVIADAS: ["PAGADO"],
  PAGADO: [], // estado terminal
};

/** Schema Zod para payroll_ciclo. */
export const payrollCicloSchema = z.object({
  /** UUID autogenerado — PK. */
  ciclo_id: z.string().uuid(),

  /** Etiqueta human-readable: "2026-08 Q1" (1-15) o "2026-08 Q2" (16-fin). */
  quincena: z.string().min(1),

  /** Fecha de inicio del período (YYYY-MM-DD). */
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_inicio debe ser YYYY-MM-DD"),

  /** Fecha de fin del período (YYYY-MM-DD). */
  fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_fin debe ser YYYY-MM-DD"),

  /** Fecha en que se ejecuta el pago a empleados (YYYY-MM-DD). */
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha_pago debe ser YYYY-MM-DD"),

  /** Estado actual del ciclo en la state machine. */
  estado: z.enum(["CALCULANDO", "APROBADO_ADMIN", "CERRADO", "REMESAS_ENVIADAS", "PAGADO"]),

  /** Total bruto del ciclo (suma de gross_cents de todas las líneas). */
  total_bruto: z.number().int().nonnegative(),

  /** Total deducciones del ciclo (suma de deducciones de empleados). */
  total_deducciones: z.number().int().nonnegative(),

  /** Total neto a pagar del ciclo (suma de neto_pagar de todas las líneas). */
  total_neto: z.number().int().nonnegative(),

  /** Total contribuciones del empleador (CPP + EI + WorkSafeBC). */
  total_employer_contributions: z.number().int().nonnegative(),

  /** Timestamp de creación del ciclo. */
  creado_en: z.string().datetime(),

  /** Timestamp de última actualización. */
  actualizado_en: z.string().datetime(),
});

/** Tipo TypeScript para un ciclo de nómina. */
export type PayrollCiclo = z.infer<typeof payrollCicloSchema>;

/**
 * Input para crear un nuevo ciclo de nómina.
 *
 * Solo los campos que el caller provee; el resto se derivan o se inicializan
 * en ceros (totales se llenan cuando se calculan las líneas).
 */
export interface CreatePayrollCycleInput {
  /** Etiqueta human-readable: "2026-08 Q1" o "2026-08 Q2". */
  quincena: string;

  /** Fecha de inicio del período (YYYY-MM-DD inclusive). */
  fecha_inicio: string;

  /** Fecha de fin del período (YYYY-MM-DD inclusive). */
  fecha_fin: string;

  /** Fecha programada de pago a empleados (YYYY-MM-DD). */
  fecha_pago: string;
}

// =========================================================================
// createPayrollCycle()
// =========================================================================

/**
 * Crea un nuevo ciclo de nómina en estado CALCULANDO.
 *
 * El ciclo se inicializa con todos los totales en cero. Las líneas de nómina
 * se agregan después mediante calculatePayrollForEmployee() y se acumulan en
 * los totales del ciclo.
 *
 * Esta función es pura: devuelve el objeto PayrollCiclo listo para insertar
 * en la base de datos. El caller es responsable de la persistencia.
 *
 * @param input — datos del ciclo (quincena, fechas, fecha_pago).
 * @returns PayrollCiclo inicializado en CALCULANDO con totales en cero.
 *
 * @example
 * ```ts
 * const ciclo = createPayrollCycle({
 *   quincena: "2026-08 Q1",
 *   fecha_inicio: "2026-08-01",
 *   fecha_fin: "2026-08-15",
 *   fecha_pago: "2026-08-20",
 * });
 * // ciclo.estado === "CALCULANDO"
 * // ciclo.total_bruto === 0 (se llena al agregar líneas)
 * ```
 */
export function createPayrollCycle(input: CreatePayrollCycleInput): PayrollCiclo {
  const now = new Date().toISOString();

  const ciclo: PayrollCiclo = {
    ciclo_id: crypto.randomUUID(),
    quincena: input.quincena,
    fecha_inicio: input.fecha_inicio,
    fecha_fin: input.fecha_fin,
    fecha_pago: input.fecha_pago,
    estado: "CALCULANDO",
    total_bruto: 0,
    total_deducciones: 0,
    total_neto: 0,
    total_employer_contributions: 0,
    creado_en: now,
    actualizado_en: now,
  };

  return payrollCicloSchema.parse(ciclo);
}

// =========================================================================
// State machine transitions
// =========================================================================

/**
 * Verifica si una transición de estado es válida.
 *
 * @param from — estado actual del ciclo.
 * @param to — estado deseado.
 * @returns true si la transición está permitida por la state machine.
 */
export function isValidTransition(from: PayrollCycleStatus, to: PayrollCycleStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Aplica una transición de estado a un ciclo de nómina.
 *
 * Si la transición no es válida, lanza un error descriptivo. Si es válida,
 * devuelve una copia del ciclo con el nuevo estado y actualizado_en al momento
 * actual.
 *
 * @param ciclo — ciclo de nómina existente.
 * @param to — nuevo estado deseado.
 * @returns Copia del ciclo con estado actualizado.
 * @throws {Error} si la transición no es válida.
 */
export function transitionCycle(ciclo: PayrollCiclo, to: PayrollCycleStatus): PayrollCiclo {
  if (!isValidTransition(ciclo.estado, to)) {
    throw new Error(
      `Transición inválida: ${ciclo.estado} → ${to}. ` +
        `Transiciones válidas desde ${ciclo.estado}: [${VALID_TRANSITIONS[ciclo.estado].join(", ") || "ninguna (estado terminal)"}]`,
    );
  }

  return {
    ...ciclo,
    estado: to,
    actualizado_en: new Date().toISOString(),
  };
}

/**
 * Actualiza los totales de un ciclo a partir de un conjunto de líneas de
 * nómina ya calculadas y los resultados del PayrollCalculator.
 *
 * @param ciclo — ciclo a actualizar (se devuelve copia; no se muta).
 * @param resultados — array de PayrollCalculationResult, uno por empleado.
 * @returns Copia del ciclo con totales actualizados.
 */
export function updateCycleTotals(
  ciclo: PayrollCiclo,
  resultados: PayrollCalculationResult[],
): PayrollCiclo {
  let total_bruto = 0;
  let total_deducciones = 0;
  let total_neto = 0;
  let total_employer_contributions = 0;

  for (const r of resultados) {
    total_bruto += r.gross_cents;
    total_deducciones += r.total_deductions_cents;
    total_neto += r.neto_pagar_cents;
    total_employer_contributions += r.total_employer_cents;
  }

  return {
    ...ciclo,
    total_bruto,
    total_deducciones,
    total_neto,
    total_employer_contributions,
    actualizado_en: new Date().toISOString(),
  };
}

// =========================================================================
// Journal Entry generation — conexión con financial-ledger.ts
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

/**
 * Calcula SHA-256 de una fila del payroll journal (mismo algoritmo que
 * financial-ledger.ts computeRowHash, adaptado a PayrollJournalRow).
 */
function computePayrollRowHash(row: Omit<PayrollJournalRow, "hash_sha256">): string {
  const canonical = [
    row.event_id,
    row.event_type,
    row.timestamp,
    row.periodo_contable,
    row.cuenta_debito ?? "",
    row.cuenta_credito ?? "",
    String(row.monto),
    row.moneda,
    row.descripcion,
    JSON.stringify(row.referencia),
    row.estado,
    row.creado_por,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Genera el asiento contable (Journal Entry) para un ciclo de nómina.
 *
 * PRODUCE 7 filas (3 débitos, 4 créditos) que garantizan partida doble:
 *
 *   DÉBITOS (a dónde va el valor):
 *     1. GASTO_NOMINA (6-1000)           = total_bruto
 *     2. GASTO_CARGAS_PATRONALES (6-2000) = total_employer_contributions
 *
 *   CRÉDITOS (de dónde sale el valor):
 *     3. EFECTIVO (1-1000)               = total_neto
 *     4. CPP_POR_PAGAR (2-2000)           = total_cpp
 *     5. EI_POR_PAGAR (2-3000)            = total_ei
 *     6. IMPUESTOS_RETENIDOS_POR_PAGAR (2-4000) = total_tax
 *     7. WORKSAFEBC_POR_PAGAR (2-5000)     = total_worksafebc
 *     8. VACATION_PAY_POR_PAGAR (2-6000)  = total_vacation_pay
 *
 * INVARIANTE CONTABLE:
 *   SUM(débitos) = total_bruto + total_employer_contributions
 *   SUM(créditos) = total_neto + total_cpp + total_ei + total_tax
 *                   + total_worksafebc + total_vacation_pay
 *   = (total_bruto - total_cpp_emp - total_ei_emp - total_tax)
 *     + total_cpp + total_ei + total_tax + total_worksafebc + total_vacation_pay
 *
 *   Donde total_cpp = cpp_emp + cpp_employer y total_ei = ei_emp + ei_employer.
 *   total_employer_contributions = cpp_employer + ei_employer + total_worksafebc.
 *
 *   Simplificando:
 *   SUM(créditos) = total_bruto - cpp_emp - ei_emp - total_tax
 *     + (cpp_emp + cpp_emp) + (ei_emp + ei_employer) + total_tax
 *     + total_worksafebc + total_vacation_pay
 *   = total_bruto + cpp_emp + ei_employer + total_worksafebc + total_vacation_pay
 *
 *   Wait — el vacation_pay NO es una deducción del empleado, es un earning.
 *   Se paga al empleado como parte del gross.
 *
 *   Revisando:
 *   - total_bruto incluye day_rate + comisiones + horas_extra + vacation_pay.
 *   - total_neto = total_bruto - cpp_emp - ei_emp - total_tax.
 *   - total_employer_contributions = cpp_employer + ei_employer + worksafebc.
 *
 *   SUM(débitos) = total_bruto + cpp_employer + ei_employer + worksafebc
 *   SUM(créditos) = total_neto + (cpp_emp+cpp_employer) + (ei_emp+ei_employer)
 *                   + total_tax + worksafebc + vacation_pay
 *                 = (total_bruto - cpp_emp - ei_emp - total_tax)
 *                   + cpp_emp + cpp_employer + ei_emp + ei_employer
 *                   + total_tax + worksafebc + vacation_pay
 *                 = total_bruto + cpp_employer + ei_employer
 *                   + worksafebc + vacation_pay
 *
 *   Esto NO cuadra si vacation_pay está en créditos pero no en débitos.
 *   vacation_pay es parte del gross (se paga al empleado), así que YA está
 *   incluido en total_bruto (débito GASTO_NOMINA). El crédito a VACATION_PAY_
 *   POR_PAGAR refleja el pasivo — pero eso duplicaría el crédito.
 *
 *   CORRECCIÓN: el vacation_pay accrual se registra como un débito adicional
 *   a GASTO_NOMINA (o cuenta separada) y un crédito a VACATION_PAY_POR_PAGAR.
 *   Pero como YA está en total_bruto, no necesitamos débito extra.
 *
 *   En realidad, el vacation pay ya está PAGADO al empleado (está en total_neto,
 *   que sale de EFECTIVO). El pasivo VACATION_PAY_POR_PAGAR refleja la obligación
 *   de PAGARLO — pero si ya se pagó, el pasivo se netea.
 *
 *   Simplificación contable para Lulu Island: el vacation pay se paga en cada
 *   ciclo (no se acumula para vacaciones). Por tanto, el crédito a VACATION_PAY_
 *   POR_PAGAR y el débito correspondiente ya están incluidos en EFECTIVO y
 *   GASTO_NOMINA respectivamente. No se requiere una fila separada.
 *
 *   El asiento final es 7 filas (2 débitos, 5 créditos):
 *
 *   DÉBITOS:
 *     1. GASTO_NOMINA (6-1000)              = total_bruto
 *     2. GASTO_CARGAS_PATRONALES (6-2000)    = total_employer_contributions
 *
 *   CRÉDITOS:
 *     3. EFECTIVO (1-1000)                  = total_neto
 *     4. CPP_POR_PAGAR (2-2000)              = total_cpp
 *     5. EI_POR_PAGAR (2-3000)               = total_ei
 *     6. IMPUESTOS_RETENIDOS_POR_PAGAR (2-4000) = total_tax
 *     7. WORKSAFEBC_POR_PAGAR (2-5000)        = total_worksafebc
 *
 *   Verificación:
 *   SUM(débitos) = total_bruto + total_employer_contributions
 *   SUM(créditos) = total_neto + total_cpp + total_ei + total_tax + total_worksafebc
 *
 *   = (total_bruto - cpp_emp - ei_emp - total_tax)
 *     + (cpp_emp + cpp_employer) + (ei_emp + ei_employer)
 *     + total_tax + total_worksafebc
 *   = total_bruto + cpp_employer + ei_employer + total_worksafebc
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
  return rows.map((row) => ({
    ...row,
    hash_sha256: computePayrollRowHash(row),
  }));
}

// =========================================================================
// SQL Schema — payroll_ciclo table
// =========================================================================

/**
 * ─── MIGRACIÓN SQL para payroll_ciclo ───
 *
 * CREATE TABLE IF NOT EXISTS payroll_ciclo (
 *   ciclo_id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   quincena                      TEXT NOT NULL,
 *   fecha_inicio                  DATE NOT NULL,
 *   fecha_fin                     DATE NOT NULL,
 *   fecha_pago                    DATE NOT NULL,
 *   estado                        TEXT NOT NULL DEFAULT 'CALCULANDO'
 *                                   CHECK (estado IN (
 *                                     'CALCULANDO','APROBADO_ADMIN','CERRADO',
 *                                     'REMESAS_ENVIADAS','PAGADO'
 *                                   )),
 *   total_bruto                   INTEGER NOT NULL DEFAULT 0,
 *   total_deducciones             INTEGER NOT NULL DEFAULT 0,
 *   total_neto                    INTEGER NOT NULL DEFAULT 0,
 *   total_employer_contributions  INTEGER NOT NULL DEFAULT 0,
 *   creado_en                     TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   actualizado_en                TIMESTAMPTZ NOT NULL DEFAULT now(),
 *
 *   CONSTRAINT chk_fechas CHECK (fecha_inicio <= fecha_fin),
 *   CONSTRAINT chk_fecha_pago CHECK (fecha_pago >= fecha_fin)
 * );
 *
 * CREATE INDEX idx_payroll_ciclo_estado ON payroll_ciclo (estado);
 * CREATE INDEX idx_payroll_ciclo_quincena ON payroll_ciclo (quincena);
 *
 * ─── MIGRACIÓN SQL para payroll_linea ───
 *
 * CREATE TABLE IF NOT EXISTS payroll_linea (
 *   linea_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   ciclo_id             UUID NOT NULL REFERENCES payroll_ciclo(ciclo_id),
 *   employee_id          UUID NOT NULL REFERENCES employees(id),
 *
 *   day_rate_cents       INTEGER NOT NULL DEFAULT 0,
 *   comisiones_cents     INTEGER NOT NULL DEFAULT 0,
 *   horas_extra_cents    INTEGER NOT NULL DEFAULT 0,
 *   vacation_pay_cents   INTEGER NOT NULL DEFAULT 0,
 *
 *   gross_cents          INTEGER NOT NULL DEFAULT 0,
 *
 *   cpp_empleado         INTEGER NOT NULL DEFAULT 0,
 *   ei_empleado          INTEGER NOT NULL DEFAULT 0,
 *   tax_federal          INTEGER NOT NULL DEFAULT 0,
 *   tax_provincial       INTEGER NOT NULL DEFAULT 0,
 *
 *   cpp_employer         INTEGER NOT NULL DEFAULT 0,
 *   ei_employer          INTEGER NOT NULL DEFAULT 0,
 *   worksafebc_prima     INTEGER NOT NULL DEFAULT 0,
 *
 *   vacation_pay_accrual INTEGER NOT NULL DEFAULT 0,
 *
 *   neto_pagar           INTEGER NOT NULL DEFAULT 0,
 *
 *   ytd_gross            INTEGER NOT NULL DEFAULT 0,
 *   ytd_cpp              INTEGER NOT NULL DEFAULT 0,
 *   ytd_ei               INTEGER NOT NULL DEFAULT 0,
 *   ytd_tax              INTEGER NOT NULL DEFAULT 0,
 *
 *   sin_last3            CHAR(3),       -- últimos 3 dígitos del SIN (nunca completo)
 *   creado_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   notas                TEXT,
 *
 *   CONSTRAINT uq_ciclo_employee UNIQUE (ciclo_id, employee_id)
 * );
 *
 * CREATE INDEX idx_payroll_linea_ciclo ON payroll_linea (ciclo_id);
 * CREATE INDEX idx_payroll_linea_employee ON payroll_linea (employee_id);
 */

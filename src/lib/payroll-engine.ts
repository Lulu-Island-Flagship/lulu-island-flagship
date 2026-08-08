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

// import type { PayrollLineaRow } from "./payroll-line";
import type { PayrollCalculationResult } from "./payroll-calculator";

// ── Payroll Chart of Accounts — canonical in payroll-chart.ts ─────────
export {
  PAYROLL_CHART_OF_ACCOUNTS,
  type PayrollCuentaContable,
} from "./payroll-chart";

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
 * **@internal** — Preferí {@link executePayrollCycle} que orquesta la
 * secuencia completa del ciclo. Llamar este paso individualmente puede
 * dejar el ciclo en un estado inconsistente.
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
 * **@internal** — Preferí {@link executePayrollCycle} que orquesta la
 * secuencia completa incluyendo la actualización de totales.
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

// ── Journal Entry types & generation — canonical in payroll-journal.ts ─
import {
  generatePayrollJournalEntry,
  type PayrollDisbursementEvent,
  type PayrollJournalRow,
  type PayrollJournalInput,
} from "./payroll-journal";
export {
  generatePayrollJournalEntry,
  type PayrollDisbursementEvent,
  type PayrollJournalRow,
  type PayrollJournalInput,
};

// =========================================================================
// executePayrollCycle — orchestrator
// =========================================================================

/**
 * Resultado de {@link executePayrollCycle}.
 */
export interface ExecutePayrollCycleResult {
  /** Ciclo en estado CERRADO con totales actualizados. */
  ciclo: PayrollCiclo;
  /** Asiento contable generado (7 filas: 2 débitos + 5 créditos). */
  journalEntry: PayrollJournalRow[];
}

/**
 * Orquesta la secuencia completa de cierre de un ciclo de nómina.
 *
 * Pipeline (atómico — falla entero si algún paso falla):
 *   1. `transitionCycle` CALCULANDO → APROBADO_ADMIN
 *   2. `transitionCycle` APROBADO_ADMIN → CERRADO
 *   3. `updateCycleTotals` con los resultados por empleado
 *   4. `generatePayrollJournalEntry` con los totales del ciclo cerrado
 *
 * Este es el punto de entrada canónico para cerrar un ciclo de nómina.
 * **No llames los pasos individuales directamente** — están documentados
 * como `@internal` porque llamarlos fuera de secuencia puede dejar el
 * ciclo en un estado inconsistente (ej. journal entry generado sin
 * totales actualizados).
 *
 * @param ciclo — ciclo en estado CALCULANDO (recién creado o con líneas calculadas).
 * @param resultados — array de {@link PayrollCalculationResult}, uno por empleado.
 * @param createdBy — quién ejecuta el cierre (user_id o "system").
 * @returns Ciclo cerrado con totales + asiento contable.
 *
 * @throws {Error} si el ciclo no está en CALCULANDO.
 * @throws {Error} si alguna transición de estado es inválida.
 * @throws {Error} si la invariante contable no se cumple.
 *
 * @example
 * ```ts
 * const ciclo = createPayrollCycle({
 *   quincena: "2026-08 Q1",
 *   fecha_inicio: "2026-08-01",
 *   fecha_fin: "2026-08-15",
 *   fecha_pago: "2026-08-20",
 * });
 *
 * // Calcular líneas por empleado...
 * const resultados = empleados.map((emp) =>
 *   calculatePayrollForEmployee(emp.id, ciclo.ciclo_id, emp.events, emp.options)
 * );
 *
 * const { ciclo: cerrado, journalEntry } = executePayrollCycle(
 *   ciclo,
 *   resultados,
 *   "admin-user-id"
 * );
 * // cerrado.estado === "CERRADO"
 * // journalEntry.length === 7
 * ```
 */
export function executePayrollCycle(
  ciclo: PayrollCiclo,
  resultados: PayrollCalculationResult[],
  createdBy: string = "system",
): ExecutePayrollCycleResult {
  // Guardrail: el ciclo debe estar en CALCULANDO
  if (ciclo.estado !== "CALCULANDO") {
    throw new Error(
      `executePayrollCycle: el ciclo debe estar en CALCULANDO (actual: ${ciclo.estado}). ` +
        `Usá los pasos individuales (@internal) solo si sabés lo que hacés.`,
    );
  }

  // Paso 1: CALCULANDO → APROBADO_ADMIN
  const aprobado = transitionCycle(ciclo, "APROBADO_ADMIN");

  // Paso 2: APROBADO_ADMIN → CERRADO
  const cerrado = transitionCycle(aprobado, "CERRADO");

  // Paso 3: Actualizar totales del ciclo con los resultados por empleado
  const conTotales = updateCycleTotals(cerrado, resultados);

  // Paso 4: Generar asiento contable
  // Derivar totales detallados desde los resultados por empleado
  let total_cpp = 0;
  let total_ei = 0;
  let total_tax = 0;
  let total_worksafebc = 0;
  let total_vacation_pay = 0;

  for (const r of resultados) {
    total_cpp += r.cpp_employee_cents + r.cpp_employer_cents;
    total_ei += r.ei_employee_cents + r.ei_employer_cents;
    total_tax += r.tax_federal_cents + r.tax_provincial_cents;
    total_worksafebc += r.worksafebc_cents;
    total_vacation_pay += r.vacation_pay_cents;
  }

  const journalEntry = generatePayrollJournalEntry(
    {
      total_bruto: conTotales.total_bruto,
      total_cpp,
      total_ei,
      total_tax,
      total_worksafebc,
      total_vacation_pay,
      total_neto: conTotales.total_neto,
      total_employer_contributions: conTotales.total_employer_contributions,
      ciclo_id: conTotales.ciclo_id,
      quincena: conTotales.quincena,
    },
    createdBy,
  );

  return { ciclo: conTotales, journalEntry };
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

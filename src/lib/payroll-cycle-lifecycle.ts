/**
 * v8.4 Capa 4 del Financial Core — Payroll Cycle Lifecycle (State Machine).
 *
 * Gestiona el ciclo de vida completo de un ciclo de nómina: creación,
 * state machine de aprobación, y actualización de totales a partir de
 * los resultados del Payroll Calculator.
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
 * Extraído de payroll-engine.ts (Paso B — god-object decomposition).
 * Renombrado de payroll-cycle.ts a payroll-cycle-lifecycle.ts para evitar
 * colisión con el módulo existente payroll-cycle.ts (date math / aggregation).
 */

import { z } from "zod";

import type { PayrollCalculationResult } from "./payroll-calculator";

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

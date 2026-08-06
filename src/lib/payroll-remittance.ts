/**
 * v8.4 Capa 4 del Financial Core — Remittance Engine.
 *
 * Gestiona la generación de remesas fiscales (PD7A, GST, WorkSafeBC) a la CRA
 * y otros organismos. Cada remesa se registra en la tabla `remesa_fiscal` y
 * genera un asiento contable (Journal Entry) automático en el Financial Ledger
 * al confirmarse el pago.
 *
 * PD7A (Statement of Account for Current Source Deductions):
 *   - Remesa quincenal de source deductions: CPP, EI, Income Tax.
 *   - Se genera por cada ciclo de nómina al cerrarse.
 *   - El empleador remite: CPP empleado + empleador, EI empleado + empleador,
 *     Income Tax (federal + provincial).
 *
 * WorkSafeBC:
 *   - Remesa independiente (solo empleador).
 *   - Se acumula por ciclo y se remite según el calendario de WorkSafeBC.
 *
 * GST:
 *   - Remesa trimestral de GST/HST cobrado a clientes.
 *   - Se conecta con tax-engine.ts para los montos.
 *
 * REGLA: todos los montos en centavos enteros (CAD). SIN parcial en logs.
 *
 * State machine del ciclo (desde payroll-engine.ts):
 *   CERRADO → REMESAS_ENVIADAS → PAGADO
 *   La transición a REMESAS_ENVIADAS ocurre cuando se genera el PD7A y se
 *   registra en remesa_fiscal con estado "pendiente".
 *
 * Interconexiones:
 *   payroll-remittance.ts ──(importa)──→ payroll-engine.ts (PayrollCiclo, PAYROLL_CHART)
 *   payroll-remittance.ts ──(importa)──→ payroll-line.ts (PayrollLineaRow)
 *   payroll-remittance.ts ──(importa)──→ financial-ledger.ts (CHART_OF_ACCOUNTS, LedgerEntryStatus)
 *   payroll-remittance.ts ──(importa)──→ cra-remittances.ts (nextBusinessDay)
 */

import { z } from "zod";
import { createHash } from "@/lib/crypto.server";

import type { PayrollCiclo } from "./payroll-engine";
import {
  PAYROLL_CHART_OF_ACCOUNTS,
  type PayrollCuentaContable,
} from "./payroll-engine";
import type { PayrollLineaRow } from "./payroll-line";
import {
  CHART_OF_ACCOUNTS,
  type LedgerEntryStatus,
} from "./financial-ledger";
import { nextBusinessDay } from "./cra-remittances";

// =========================================================================
// RemesaFiscal — tabla remesa_fiscal
// =========================================================================

/** Tipos de remesa fiscal soportados. */
export type RemesaFiscalTipo = "PD7A" | "GST" | "WorkSafeBC";

/** Estados de una remesa fiscal. */
export type RemesaFiscalEstado = "pendiente" | "pagado" | "vencido";

/** Schema Zod para la tabla `remesa_fiscal`. */
export const remesaFiscalSchema = z.object({
  /** UUID autogenerado — PK. */
  remesa_id: z.string().uuid(),

  /** FK a payroll_ciclo.ciclo_id — ciclo de nómina origen (null para GST que no viene de un ciclo). */
  ciclo_id: z.string().uuid().nullable(),

  /** Tipo de remesa. */
  tipo: z.enum(["PD7A", "GST", "WorkSafeBC"]),

  /** Período contable YYYY-MM. */
  periodo: z.string().regex(/^\d{4}-\d{2}$/, "periodo debe ser YYYY-MM"),

  /** Monto total a remesar en centavos enteros CAD. */
  monto_total: z.number().int().nonnegative(),

  /** Fecha límite de pago YYYY-MM-DD (ajustada al siguiente día hábil CRA). */
  fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),

  /** Fecha de pago efectivo YYYY-MM-DD (null si pendiente). */
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),

  /** Estado actual de la remesa. */
  estado: z.enum(["pendiente", "pagado", "vencido"]),

  /** Comprobante / confirmation number de CRA (null si no presentado). */
  comprobante_cra: z.string().nullable(),

  /** Timestamp de creación. */
  creado_en: z.string().datetime(),

  /** Timestamp de última actualización. */
  actualizado_en: z.string().datetime(),
});

/** Tipo TypeScript inferido del schema. */
export type RemesaFiscal = z.infer<typeof remesaFiscalSchema>;

/**
 * Input para crear una nueva remesa fiscal.
 * El caller provee los datos de negocio; el resto (remesa_id, timestamps)
 * se generan en createRemesaFiscal().
 */
export interface CreateRemesaFiscalInput {
  ciclo_id: string | null;
  tipo: RemesaFiscalTipo;
  periodo: string;
  monto_total: number;
  fecha_vencimiento: string;
}

// =========================================================================
// PD7A — Statement of Account for Current Source Deductions
// =========================================================================

/**
 * Datos estructurados del formulario PD7A de CRA.
 *
 * El PD7A (Statement of Account for Current Source Deductions) es la
 * declaración que el empleador presenta a CRA por cada período de remesa
 * de source deductions (quincenal para remitentes regulares).
 *
 * Campos alineados con el formulario CRA PD7A vigente.
 */
export interface Pd7aData {
  /** Período que cubre la declaración. */
  periodStartISO: string;
  /** Fin del período. */
  periodEndISO: string;
  /** Fecha límite de pago (15 días después del fin del período, ajustado a día hábil). */
  dueDateISO: string;

  /** Business Number del empleador (9 dígitos + RP). */
  businessNumber: string;

  /** Número de empleados en el período. */
  employeeCount: number;

  /** ── Gross Payroll ─────────────────────────────────────────────── */
  /** Total bruto pagado en el período (centavos). */
  grossPayrollCents: number;

  /** ── CPP Contributions ─────────────────────────────────────────── */
  /** CPP empleado (centavos). */
  cppEmployeeCents: number;
  /** CPP empleador (centavos, matching 1:1). */
  cppEmployerCents: number;
  /** CPP total a remesar (empleado + empleador, centavos). */
  cppTotalCents: number;

  /** ── EI Premiums ───────────────────────────────────────────────── */
  /** EI empleado (centavos). */
  eiEmployeeCents: number;
  /** EI empleador (centavos, 1.4× empleado). */
  eiEmployerCents: number;
  /** EI total a remesar (empleado + empleador, centavos). */
  eiTotalCents: number;

  /** ── Income Tax ────────────────────────────────────────────────── */
  /** Impuesto federal retenido (centavos). */
  taxFederalCents: number;
  /** Impuesto provincial BC retenido (centavos). */
  taxProvincialCents: number;
  /** Impuesto total retenido (federal + provincial, centavos). */
  taxTotalCents: number;

  /** ── Totals ────────────────────────────────────────────────────── */
  /** Total a remesar = CPP total + EI total + Tax total (centavos). */
  totalRemittanceCents: number;

  /** ── Metadata ──────────────────────────────────────────────────── */
  /** ID del ciclo de nómina origen. */
  cicloId: string;
  /** Quincena del ciclo (ej. "2026-08 Q1"). */
  quincena: string;
  /** Timestamp de generación del PD7A. */
  generatedAtISO: string;
}

/**
 * Genera los datos estructurados del PD7A para un ciclo de nómina.
 *
 * Calcula los totales de CPP (empleado + empleador), EI (empleado + empleador)
 * e Income Tax (federal + provincial) a partir de las líneas de nómina del
 * ciclo. Estos son los montos que el empleador debe remitir a CRA.
 *
 * La fecha de vencimiento se calcula como 15 días después del fin del período,
 * ajustada al siguiente día hábil según el calendario CRA.
 *
 * @param ciclo — Ciclo de nómina (de payroll_ciclo).
 * @param lineas — Líneas de nómina del ciclo (de payroll_linea).
 * @param businessNumber — Business Number del empleador (default: "000000000RP0001").
 * @returns Pd7aData con todos los campos requeridos por CRA.
 *
 * @example
 * ```ts
 * const pd7a = generatePd7a(ciclo, lineas, "123456789RP0001");
 * // pd7a.totalRemittanceCents = cppTotal + eiTotal + taxTotal
 * // pd7a.dueDateISO = "2026-09-01" (15 días después de fecha_fin, ajustado)
 * ```
 */
export function generatePd7a(
  ciclo: PayrollCiclo,
  lineas: PayrollLineaRow[],
  businessNumber: string = "000000000RP0001",
): Pd7aData {
  // ── Totales desde las líneas ──────────────────────────────────────
  let cppEmployeeCents = 0;
  let cppEmployerCents = 0;
  let eiEmployeeCents = 0;
  let eiEmployerCents = 0;
  let taxFederalCents = 0;
  let taxProvincialCents = 0;

  for (const linea of lineas) {
    cppEmployeeCents += linea.cpp_empleado;
    cppEmployerCents += linea.cpp_employer;
    eiEmployeeCents += linea.ei_empleado;
    eiEmployerCents += linea.ei_employer;
    taxFederalCents += linea.tax_federal;
    taxProvincialCents += linea.tax_provincial;
  }

  const cppTotalCents = cppEmployeeCents + cppEmployerCents;
  const eiTotalCents = eiEmployeeCents + eiEmployerCents;
  const taxTotalCents = taxFederalCents + taxProvincialCents;
  const totalRemittanceCents = cppTotalCents + eiTotalCents + taxTotalCents;

  // ── Fecha de vencimiento: 15 días después del fin del período ─────
  const periodoFin = new Date(`${ciclo.fecha_fin}T00:00:00.000Z`);
  const dueDateRaw = new Date(periodoFin.getTime() + 15 * 24 * 60 * 60 * 1000);
  const dueDateISO = nextBusinessDay(dueDateRaw.toISOString().slice(0, 10));

  return {
    periodStartISO: ciclo.fecha_inicio,
    periodEndISO: ciclo.fecha_fin,
    dueDateISO,
    businessNumber,
    employeeCount: lineas.length,
    grossPayrollCents: ciclo.total_bruto,
    cppEmployeeCents,
    cppEmployerCents,
    cppTotalCents,
    eiEmployeeCents,
    eiEmployerCents,
    eiTotalCents,
    taxFederalCents,
    taxProvincialCents,
    taxTotalCents,
    totalRemittanceCents,
    cicloId: ciclo.ciclo_id,
    quincena: ciclo.quincena,
    generatedAtISO: new Date().toISOString(),
  };
}

/**
 * Crea un registro RemesaFiscal a partir de los datos del PD7A.
 *
 * El caller debe persistir el objeto devuelto en la tabla `remesa_fiscal`.
 * La remesa se crea en estado "pendiente".
 *
 * @param pd7a — Datos del PD7A generados por generatePd7a().
 * @returns RemesaFiscal listo para insertar en base de datos.
 */
export function createRemesaFromPd7a(pd7a: Pd7aData): RemesaFiscal {
  const now = new Date().toISOString();
  const periodo = pd7a.periodStartISO.slice(0, 7); // YYYY-MM

  const remesa: RemesaFiscal = {
    remesa_id: crypto.randomUUID(),
    ciclo_id: pd7a.cicloId,
    tipo: "PD7A",
    periodo,
    monto_total: pd7a.totalRemittanceCents,
    fecha_vencimiento: pd7a.dueDateISO,
    fecha_pago: null,
    estado: "pendiente",
    comprobante_cra: null,
    creado_en: now,
    actualizado_en: now,
  };

  return remesaFiscalSchema.parse(remesa);
}

// =========================================================================
// Remittance Summary — resumen anual de remesas
// =========================================================================

/**
 * Un ítem en el resumen anual de remesas.
 * Agrupa remesas por período (mes) y tipo.
 */
export interface RemittanceSummaryItem {
  /** Período YYYY-MM. */
  periodo: string;
  /** Tipo de remesa. */
  tipo: RemesaFiscalTipo;
  /** Cantidad de remesas en el período. */
  count: number;
  /** Monto total remesado en el período (centavos). */
  totalCents: number;
  /** Monto ya pagado en el período (centavos). */
  paidCents: number;
  /** Monto pendiente de pago en el período (centavos). */
  pendingCents: number;
}

/**
 * Genera un resumen anual de remesas fiscales agrupado por período y tipo.
 *
 * Útil para reconciliación fiscal y reportes de fin de año.
 *
 * @param remesas — Array de RemesaFiscal (el caller las obtiene de la DB).
 * @param anio — Año calendario a resumir (YYYY).
 * @returns Array de RemittanceSummaryItem ordenado por período y tipo.
 */
export function generateRemittanceSummary(
  remesas: RemesaFiscal[],
  anio: number,
): RemittanceSummaryItem[] {
  const yearPrefix = String(anio);
  const filtered = remesas.filter((r) => r.periodo.startsWith(yearPrefix));

  // Agrupar por periodo + tipo
  const groups = new Map<string, {
    periodo: string;
    tipo: RemesaFiscalTipo;
    count: number;
    totalCents: number;
    paidCents: number;
    pendingCents: number;
  }>();

  for (const r of filtered) {
    const key = `${r.periodo}|${r.tipo}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalCents += r.monto_total;
      if (r.estado === "pagado") {
        existing.paidCents += r.monto_total;
      } else {
        existing.pendingCents += r.monto_total;
      }
    } else {
      groups.set(key, {
        periodo: r.periodo,
        tipo: r.tipo,
        count: 1,
        totalCents: r.monto_total,
        paidCents: r.estado === "pagado" ? r.monto_total : 0,
        pendingCents: r.estado !== "pagado" ? r.monto_total : 0,
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const periodoCmp = a.periodo.localeCompare(b.periodo);
    if (periodoCmp !== 0) return periodoCmp;
    return a.tipo.localeCompare(b.tipo);
  });
}

// =========================================================================
// Remittance Deadlines — fechas límite de pago
// =========================================================================

/**
 * Calcula la fecha límite de pago para un ciclo de nómina.
 *
 * Regla: 15 días calendario después de la fecha de fin del período,
 * ajustada al siguiente día hábil según el calendario de CRA.
 *
 * @param ciclo — Ciclo de nómina.
 * @returns Fecha límite YYYY-MM-DD ajustada a día hábil.
 */
export function getRemittanceDeadline(ciclo: PayrollCiclo): string {
  const periodoFin = new Date(`${ciclo.fecha_fin}T00:00:00.000Z`);
  const dueDateRaw = new Date(periodoFin.getTime() + 15 * 24 * 60 * 60 * 1000);
  return nextBusinessDay(dueDateRaw.toISOString().slice(0, 10));
}

/**
 * Calcula la fecha límite de pago a partir de una fecha de fin de período.
 *
 * Útil cuando no se tiene el ciclo completo (ej. para GST/WorkSafeBC
 * que no vienen de un ciclo de nómina).
 *
 * @param fechaFin — Fecha de fin del período YYYY-MM-DD.
 * @param diasPlazo — Días hábiles después del fin del período (default: 15).
 * @returns Fecha límite YYYY-MM-DD ajustada a día hábil.
 */
export function getDeadlineFromEndDate(
  fechaFin: string,
  diasPlazo: number = 15,
): string {
  const periodoFin = new Date(`${fechaFin}T00:00:00.000Z`);
  const dueDateRaw = new Date(periodoFin.getTime() + diasPlazo * 24 * 60 * 60 * 1000);
  return nextBusinessDay(dueDateRaw.toISOString().slice(0, 10));
}

// =========================================================================
// Overdue Remittances — remesas vencidas
// =========================================================================

/**
 * Una remesa vencida con detalle de días de atraso.
 */
export interface OverdueRemittance {
  /** La remesa fiscal original. */
  remesa: RemesaFiscal;
  /** Días de atraso desde la fecha de vencimiento. */
  diasAtraso: number;
  /** Si ya pasó la fecha de vencimiento y el estado sigue siendo "pendiente". */
  estaVencida: boolean;
}

/**
 * Identifica remesas no pagadas con días de atraso.
 *
 * Marca como vencidas aquellas cuyo `fecha_vencimiento` ya pasó y el estado
 * es "pendiente". Calcula los días de atraso para cada una.
 *
 * @param remesas — Array de RemesaFiscal a evaluar.
 * @param todayISO — Fecha de referencia YYYY-MM-DD (default: hoy).
 * @returns Array de OverdueRemittance ordenado por días de atraso (descendente).
 */
export function getOverdueRemittances(
  remesas: RemesaFiscal[],
  todayISO?: string,
): OverdueRemittance[] {
  const today = todayISO ?? new Date().toISOString().slice(0, 10);
  const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();

  const overdue: OverdueRemittance[] = [];

  for (const remesa of remesas) {
    // Solo evaluar las que no están pagadas
    if (remesa.estado === "pagado") continue;

    const dueMs = new Date(`${remesa.fecha_vencimiento}T00:00:00.000Z`).getTime();
    const diasAtraso = Math.max(0, Math.floor((todayMs - dueMs) / (24 * 60 * 60 * 1000)));
    const estaVencida = todayMs > dueMs;

    overdue.push({
      remesa,
      diasAtraso,
      estaVencida,
    });
  }

  return overdue.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

// =========================================================================
// Verify & Mark — transiciones de estado de remesa
// =========================================================================

/**
 * Marca una remesa como pagada.
 *
 * El caller es responsable de la persistencia. Esta función devuelve una
 * copia del objeto con los campos actualizados.
 *
 * @param remesa — RemesaFiscal a marcar como pagada.
 * @param fechaPago — Fecha de pago YYYY-MM-DD.
 * @param comprobanteCRA — Número de comprobante de CRA (opcional).
 * @returns Copia de la remesa con estado "pagado".
 */
export function markRemittanceAsPaid(
  remesa: RemesaFiscal,
  fechaPago: string,
  comprobanteCRA?: string,
): RemesaFiscal {
  return remesaFiscalSchema.parse({
    ...remesa,
    estado: "pagado",
    fecha_pago: fechaPago,
    comprobante_cra: comprobanteCRA ?? remesa.comprobante_cra,
    actualizado_en: new Date().toISOString(),
  });
}

/**
 * Verifica si una remesa está en fecha de pago.
 *
 * @param remesa — RemesaFiscal a verificar.
 * @param todayISO — Fecha de referencia YYYY-MM-DD (default: hoy).
 * @returns true si la fecha de vencimiento aún no ha pasado.
 */
export function isRemittanceOnTime(
  remesa: RemesaFiscal,
  todayISO?: string,
): boolean {
  const today = todayISO ?? new Date().toISOString().slice(0, 10);
  return new Date(`${remesa.fecha_vencimiento}T00:00:00.000Z`).getTime()
    >= new Date(`${today}T00:00:00.000Z`).getTime();
}

// =========================================================================
// Remittance Journal Entry — asiento contable automático
// =========================================================================

/**
 * Una fila del Journal Entry de remesa fiscal.
 *
 * Estructura compatible con financial_ledger para registrar el pago de
 * remesas (debita pasivos, acredita efectivo). Sigue el mismo patrón
 * que PayrollJournalRow en payroll-engine.ts.
 */
export interface RemittanceJournalRow {
  ledger_id: string;
  event_id: string;
  event_type: "remittance_payment";
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
 * Datos de entrada para generar el JE de pago de remesa.
 */
export interface RemittanceJEInput {
  /** Total CPP a remesar (empleado + empleador, centavos). */
  totalCpp: number;
  /** Total EI a remesar (empleado + empleador, centavos). */
  totalEi: number;
  /** Total impuestos retenidos a remesar (federal + provincial, centavos). */
  totalTax: number;
  /** Total WorkSafeBC a remesar (centavos, 0 si no aplica). */
  totalWorksafebc: number;
  /** ID de la remesa fiscal. */
  remesaId: string;
  /** Tipo de remesa. */
  tipo: RemesaFiscalTipo;
  /** Período de la remesa YYYY-MM. */
  periodo: string;
}

/**
 * Calcula SHA-256 de una fila del remittance journal.
 *
 * Mismo algoritmo que financial-ledger.ts y payroll-engine.ts.
 */
function computeRemittanceRowHash(row: Omit<RemittanceJournalRow, "hash_sha256">): string {
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
 * Genera el asiento contable (Journal Entry) para el pago de una remesa fiscal.
 *
 * REGISTRA la liquidación de los pasivos de nómina contra la salida de
 * efectivo. Según el tipo de remesa, se debitan distintas cuentas de pasivo:
 *
 *   PD7A (Source Deductions):
 *     DÉBITOS:
 *       1. CPP_POR_PAGAR (2-2200)          = total_cpp
 *       2. EI_POR_PAGAR (2-2300)           = total_ei
 *       3. IMPUESTOS_RETENIDOS_POR_PAGAR (2-2400) = total_tax
 *     CRÉDITO:
 *       4. EFECTIVO (1-1000)               = total_cpp + total_ei + total_tax
 *
 *   WorkSafeBC:
 *     DÉBITO:
 *       1. WORKSAFEBC_POR_PAGAR (2-2500)   = total_worksafebc
 *     CRÉDITO:
 *       2. EFECTIVO (1-1000)               = total_worksafebc
 *
 *   GST:
 *     DÉBITO:
 *       1. GST_PAYABLE (2-2020)            = monto GST
 *     CRÉDITO:
 *       2. EFECTIVO (1-1000)               = monto GST
 *
 * INVARIANTE CONTABLE: SUM(débitos) = SUM(créditos).
 *
 * El caller es responsable de insertar las filas en `financial_ledger`
 * dentro de la misma transacción DB.
 *
 * @param input — Datos de la remesa a pagar.
 * @param createdBy — Quién registra el pago (user_id o "system").
 * @returns Array de RemittanceJournalRow con hash SHA-256 por fila.
 * @throws {Error} si la invariante contable no se cumple.
 */
export function generateRemittanceJE(
  input: RemittanceJEInput,
  createdBy: string = "system",
): RemittanceJournalRow[] {
  const eventId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const periodo = timestamp.slice(0, 7);

  const referencia: Record<string, unknown> = {
    remesa_id: input.remesaId,
    tipo: input.tipo,
    periodo: input.periodo,
    total_cpp: input.totalCpp,
    total_ei: input.totalEi,
    total_tax: input.totalTax,
    total_worksafebc: input.totalWorksafebc,
  };

  const rows: Omit<RemittanceJournalRow, "hash_sha256">[] = [];

  switch (input.tipo) {
    case "PD7A": {
      const totalRemittance = input.totalCpp + input.totalEi + input.totalTax;

      // DÉBITO 1: CPP por Pagar → se liquida
      if (input.totalCpp > 0) {
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: PAYROLL_CHART_OF_ACCOUNTS.CPP_POR_PAGAR,
          cuenta_credito: null,
          monto: input.totalCpp,
          moneda: "CAD",
          descripcion: `Pago PD7A ${input.periodo} — Liquidación CPP [DÉBITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });
      }

      // DÉBITO 2: EI por Pagar → se liquida
      if (input.totalEi > 0) {
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: PAYROLL_CHART_OF_ACCOUNTS.EI_POR_PAGAR,
          cuenta_credito: null,
          monto: input.totalEi,
          moneda: "CAD",
          descripcion: `Pago PD7A ${input.periodo} — Liquidación EI [DÉBITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });
      }

      // DÉBITO 3: Impuestos Retenidos por Pagar → se liquidan
      if (input.totalTax > 0) {
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: PAYROLL_CHART_OF_ACCOUNTS.IMPUESTOS_RETENIDOS_POR_PAGAR,
          cuenta_credito: null,
          monto: input.totalTax,
          moneda: "CAD",
          descripcion: `Pago PD7A ${input.periodo} — Liquidación Income Tax [DÉBITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });
      }

      // CRÉDITO: Efectivo → sale de la empresa
      if (totalRemittance > 0) {
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: null,
          cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
          monto: totalRemittance,
          moneda: "CAD",
          descripcion: `Pago PD7A ${input.periodo} — Efectivo a CRA [CRÉDITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });
      }
      break;
    }

    case "WorkSafeBC": {
      if (input.totalWorksafebc > 0) {
        // DÉBITO: WorkSafeBC por Pagar → se liquida
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: PAYROLL_CHART_OF_ACCOUNTS.WORKSAFEBC_POR_PAGAR,
          cuenta_credito: null,
          monto: input.totalWorksafebc,
          moneda: "CAD",
          descripcion: `Pago WorkSafeBC ${input.periodo} — Liquidación [DÉBITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });

        // CRÉDITO: Efectivo
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: null,
          cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
          monto: input.totalWorksafebc,
          moneda: "CAD",
          descripcion: `Pago WorkSafeBC ${input.periodo} — Efectivo [CRÉDITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });
      }
      break;
    }

    case "GST": {
      // GST: el monto viene en totalCpp como portador (reusamos el campo)
      const gstAmount = input.totalCpp;
      if (gstAmount > 0) {
        // DÉBITO: GST Payable → se liquida
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: CHART_OF_ACCOUNTS.GST_PAYABLE,
          cuenta_credito: null,
          monto: gstAmount,
          moneda: "CAD",
          descripcion: `Pago GST ${input.periodo} — Liquidación GST [DÉBITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });

        // CRÉDITO: Efectivo
        rows.push({
          ledger_id: ledgerId,
          event_id: eventId,
          event_type: "remittance_payment",
          timestamp,
          periodo_contable: periodo,
          cuenta_debito: null,
          cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
          monto: gstAmount,
          moneda: "CAD",
          descripcion: `Pago GST ${input.periodo} — Efectivo a CRA [CRÉDITO]`,
          referencia,
          estado: "confirmado",
          creado_por: createdBy,
        });
      }
      break;
    }
  }

  // ── Verificar invariante contable ────────────────────────────────────
  const sumDebito = rows
    .filter((r) => r.cuenta_debito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  const sumCredito = rows
    .filter((r) => r.cuenta_credito !== null)
    .reduce((sum, r) => sum + r.monto, 0);

  if (rows.length > 0 && sumDebito !== sumCredito) {
    throw new Error(
      `generateRemittanceJE: invariante contable rota — ` +
        `SUM(débito)=${sumDebito} ≠ SUM(crédito)=${sumCredito}. ` +
        `remesa=${input.remesaId}, tipo=${input.tipo}, periodo=${input.periodo}. ` +
        `Verificar: cpp=${input.totalCpp}, ei=${input.totalEi}, tax=${input.totalTax}, wsbc=${input.totalWorksafebc}`,
    );
  }

  // ── Calcular hash SHA-256 por fila ──────────────────────────────────
  return rows.map((row) => ({
    ...row,
    hash_sha256: computeRemittanceRowHash(row),
  }));
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Convierte centavos a dólares con 2 decimales para display.
 * Función pura — no redondea (la precisión ya viene en centavos enteros).
 */
export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/**
 * Determina si una remesa PD7A debe generarse para un ciclo.
 *
 * Solo los ciclos en estado CERRADO o posterior deben tener PD7A generado.
 *
 * @param ciclo — Ciclo de nómina.
 * @returns true si el ciclo está listo para generar PD7A.
 */
export function shouldGeneratePd7a(ciclo: PayrollCiclo): boolean {
  const estadosValidos: PayrollCiclo["estado"][] = [
    "CERRADO",
    "REMESAS_ENVIADAS",
    "PAGADO",
  ];
  return estadosValidos.includes(ciclo.estado);
}

// =========================================================================
// SQL Schema — tabla remesa_fiscal
// =========================================================================

/**
 * ─── MIGRACIÓN SQL para remesa_fiscal ───
 *
 * CREATE TABLE IF NOT EXISTS remesa_fiscal (
 *   remesa_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   ciclo_id          UUID REFERENCES payroll_ciclo(ciclo_id),
 *   tipo              TEXT NOT NULL CHECK (tipo IN ('PD7A','GST','WorkSafeBC')),
 *   periodo           TEXT NOT NULL CHECK (periodo ~ '^\d{4}-\d{2}$'),
 *   monto_total       INTEGER NOT NULL CHECK (monto_total >= 0),
 *   fecha_vencimiento DATE NOT NULL,
 *   fecha_pago        DATE,
 *   estado            TEXT NOT NULL DEFAULT 'pendiente'
 *                       CHECK (estado IN ('pendiente','pagado','vencido')),
 *   comprobante_cra   TEXT,
 *   creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
 *
 *   CONSTRAINT chk_fecha_pago CHECK (fecha_pago IS NULL OR fecha_pago <= CURRENT_DATE)
 * );
 *
 * CREATE INDEX idx_remesa_fiscal_ciclo ON remesa_fiscal (ciclo_id);
 * CREATE INDEX idx_remesa_fiscal_periodo ON remesa_fiscal (periodo);
 * CREATE INDEX idx_remesa_fiscal_estado ON remesa_fiscal (estado);
 * CREATE INDEX idx_remesa_fiscal_vencimiento ON remesa_fiscal (fecha_vencimiento)
 *   WHERE estado = 'pendiente';
 */

/**
 * Capa 5 — Tax Engine: GST/PST para British Columbia (Canada).
 *
 * Calcula obligaciones fiscales al cierre de cada período contable a partir
 * de las filas del Financial Ledger (Capa 0) y genera los asientos contables
 * de devengo (Journal Entries) que registran el pasivo fiscal.
 *
 * Reglas fiscales de BC:
 *  - GST (Goods and Services Tax): 5% federal. El GST pagado en compras y
 *    gastos (Input Tax Credits, ITCs) ES recuperable — se compensa contra
 *    el GST cobrado en ventas.
 *  - PST (Provincial Sales Tax): 7% provincial. El PST pagado en compras
 *    y gastos NO es recuperable en BC — solo se declara el PST cobrado en
 *    ventas (no hay input credits para PST).
 *
 * Asientos de devengo (generados por recordTaxObligation):
 *   GST: Débito 4-4010 (Revenue contra) → Crédito 2-2020 (GST Payable)
 *   PST: Débito 4-4010 (Revenue contra) → Crédito 2-2030 (PST Payable)
 *
 * Frecuencia de declaración (filing frequency):
 *   - Trimestral si revenue anual < $3,000,000
 *   - Mensual si revenue anual ≥ $3,000,000
 *
 * Todas las funciones de cálculo son puras: reciben los datos del ledger
 * (pre-filtrados por el caller desde la DB) y no tocan base de datos.
 */

import { z } from "zod";
import {
  generateJournalEntry,
  CHART_OF_ACCOUNTS,
  type BusinessEvent,
  type JournalEntryRow,
} from "@/lib/financial-ledger";

// =========================================================================
// Tax Rates (BC)
// =========================================================================

// Fix (auditoría MANIFEST v4.2 · B.1): fuente única de tasas en pricing/taxes.ts
// (evita divergencia financiera si una tasa cambia). Re-export para no romper
// la API pública de tax-engine.
import { GST_RATE, PST_RATE } from "@/lib/pricing/taxes";
export { GST_RATE, PST_RATE };

/** Small supplier threshold: below this, GST registration is voluntary */
export const SMALL_SUPPLIER_THRESHOLD_CAD = 30_000;

/** Annual revenue threshold for monthly filing (vs quarterly) */
export const MONTHLY_FILING_THRESHOLD_CAD = 3_000_000;

// =========================================================================
// Domain types — obligacion_impuesto
// =========================================================================

/** Tipo de impuesto para la tabla obligacion_impuesto. */
export type TaxType = "GST" | "PST";

/**
 * Estado de una obligación fiscal.
 *
 * - PENDIENTE: obligación generada, no declarada aún.
 * - DECLARADO: return presentado ante CRA / BC MoF, pago pendiente o realizado.
 * - PAGADO: remesa confirmada y conciliada.
 */
export type TaxObligationStatus = "PENDIENTE" | "DECLARADO" | "PAGADO";

/**
 * Una fila de la tabla `obligacion_impuesto`.
 *
 * Representa la obligación fiscal de un período para GST o PST.
 * Se crea al cierre contable del período vía `recordTaxObligation()`.
 */
export interface TaxObligation {
  /** UUID autogenerado — primary key */
  obligacion_id: string;
  /** Período contable en formato YYYY-MM (ej. "2026-08") */
  periodo: string;
  /** Tipo de impuesto: GST o PST */
  tipo: TaxType;
  /** Total de impuesto cobrado en ventas del período, en centavos */
  collected: number;
  /** Input credits (solo GST): impuesto pagado en compras/gastos recuperable, en centavos */
  input_credits: number;
  /** Neto a remitir: collected - input_credits, en centavos */
  neto: number;
  /** Fecha de vencimiento de la declaración (ISO 8601) */
  fecha_vencimiento: string;
  /** Estado actual de la obligación */
  estado: TaxObligationStatus;
  /** Fecha en que se presentó la declaración (ISO 8601), null si aún no declarado */
  fecha_declaracion: string | null;
  /** UUID del admin que generó / gestionó la obligación */
  admin_id: string;
}

export const TaxObligationSchema = z.object({
  obligacion_id: z.string().uuid(),
  periodo: z.string().regex(/^\d{4}-\d{2}$/, "periodo debe ser YYYY-MM"),
  tipo: z.enum(["GST", "PST"]),
  collected: z.number().int().nonnegative(),
  input_credits: z.number().int().nonnegative(),
  neto: z.number().int(),
  fecha_vencimiento: z.string().min(1),
  estado: z.enum(["PENDIENTE", "DECLARADO", "PAGADO"]),
  fecha_declaracion: z.string().nullable(),
  admin_id: z.string().uuid(),
});

// =========================================================================
// Input types for transaction-based calculation
// =========================================================================

/**
 * Un registro de venta (o compra) con su componente de impuesto.
 * Útil para callers que ya tienen el breakdown impositivo por transacción.
 */
export interface TaxableTransaction {
  /** ID de la orden / factura / compra */
  source_id: string;
  /** Fecha de la transacción (ISO 8601) */
  fecha: string;
  /** Monto base (antes de impuestos) en centavos */
  base_cents: number;
  /** GST cobrado/pagado en esta transacción, en centavos */
  gst_cents: number;
  /** PST cobrado/pagado en esta transacción, en centavos */
  pst_cents: number;
  /** Tipo de transacción: "venta" (cobramos GST/PST) o "compra" (pagamos GST/PST) */
  tipo: "venta" | "compra";
}

// =========================================================================
// Ledger-row-based calculation functions
//
// Estas funciones operan directamente sobre JournalEntryRow[] del Financial
// Ledger. El caller es responsable de pre-filtrar las filas por período
// (periodo_contable) desde la DB antes de pasarlas aquí.
// =========================================================================

/**
 * Calcula el GST total cobrado en ventas durante un período a partir de
 * las filas del Financial Ledger.
 *
 * Suma los créditos a GST_PAYABLE (2-2020) generados por eventos
 * de devengo fiscal (tax_gst_accrual) dentro del período.
 *
 * Corresponde al requerimiento: SUM de GST en ventas desde financial_ledger.
 *
 * @param rows — Filas del ledger pre-filtradas por periodo_contable.
 * @param periodo — Período contable YYYY-MM (para filtrado adicional en-memoria).
 * @returns GST cobrado en centavos.
 */
export function calculateGstCollected(
  rows: JournalEntryRow[],
  periodo: string,
): number {
  return rows
    .filter(
      (r) =>
        r.periodo_contable === periodo &&
        r.cuenta_credito === CHART_OF_ACCOUNTS.GST_PAYABLE &&
        r.estado === "confirmado",
    )
    .reduce((sum, r) => sum + r.monto, 0);
}

/**
 * Calcula los Input Tax Credits de GST: GST pagado en compras y gastos
 * que es recuperable ante la CRA.
 *
 * Suma los débitos a GST_ITC_RECEIVABLE (1-2025) — es decir, el GST que
 * la empresa pagó en sus compras/gastos y que la CRA le devolverá o
 * compensará contra el GST cobrado.
 *
 * En BC, el GST pagado en compras/gastos operativos ES recuperable.
 *
 * @param rows — Filas del ledger pre-filtradas por periodo_contable.
 * @param periodo — Período contable YYYY-MM.
 * @returns GST ITCs en centavos.
 */
export function calculateGstInputCredits(
  rows: JournalEntryRow[],
  periodo: string,
): number {
  return rows
    .filter(
      (r) =>
        r.periodo_contable === periodo &&
        r.cuenta_debito === CHART_OF_ACCOUNTS.GST_ITC_RECEIVABLE &&
        r.estado === "confirmado",
    )
    .reduce((sum, r) => sum + r.monto, 0);
}

/**
 * Calcula el GST neto a remitir: GST cobrado - ITCs.
 *
 * Si el resultado es negativo (ITCs > cobrado), la CRA emite un reembolso
 * al contribuyente.
 *
 * @param rows — Filas del ledger pre-filtradas por periodo_contable.
 * @param periodo — Período contable YYYY-MM.
 * @returns GST neto en centavos (positivo = a pagar, negativo = reembolso).
 */
export function calculateGstNet(
  rows: JournalEntryRow[],
  periodo: string,
): number {
  return (
    calculateGstCollected(rows, periodo) -
    calculateGstInputCredits(rows, periodo)
  );
}

/**
 * Calcula el PST total cobrado en ventas durante un período.
 *
 * Suma los créditos a PST_PAYABLE (2-2030) generados por eventos
 * de devengo fiscal (tax_pst_accrual).
 *
 * @param rows — Filas del ledger pre-filtradas por periodo_contable.
 * @param periodo — Período contable YYYY-MM.
 * @returns PST cobrado en centavos.
 */
export function calculatePstCollected(
  rows: JournalEntryRow[],
  periodo: string,
): number {
  return rows
    .filter(
      (r) =>
        r.periodo_contable === periodo &&
        r.cuenta_credito === CHART_OF_ACCOUNTS.PST_PAYABLE &&
        r.estado === "confirmado",
    )
    .reduce((sum, r) => sum + r.monto, 0);
}

/**
 * Calcula el PST neto a remitir.
 *
 * En BC, el PST pagado en compras NO es recuperable (no hay input credits).
 * Por lo tanto, PST Neto = PST Cobrado.
 *
 * @param rows — Filas del ledger pre-filtradas por periodo_contable.
 * @param periodo — Período contable YYYY-MM.
 * @returns PST neto en centavos.
 */
export function calculatePstNet(
  rows: JournalEntryRow[],
  periodo: string,
): number {
  return calculatePstCollected(rows, periodo);
}

// =========================================================================
// Transaction-based calculation functions (convenience)
// =========================================================================

/**
 * Calcula el GST total cobrado en ventas a partir de una lista de
 * transacciones individuales con breakdown impositivo.
 *
 * @param transactions — Transacciones del período.
 * @returns GST cobrado en centavos.
 */
export function calculateGstCollectedFromTransactions(
  transactions: TaxableTransaction[],
): number {
  return transactions
    .filter((t) => t.tipo === "venta")
    .reduce((sum, t) => sum + t.gst_cents, 0);
}

/**
 * Calcula los Input Tax Credits de GST a partir de transacciones de compra.
 *
 * @param transactions — Transacciones del período.
 * @returns GST ITCs en centavos.
 */
export function calculateGstInputCreditsFromTransactions(
  transactions: TaxableTransaction[],
): number {
  return transactions
    .filter((t) => t.tipo === "compra")
    .reduce((sum, t) => sum + t.gst_cents, 0);
}

/**
 * Calcula el GST neto a remitir desde transacciones individuales.
 *
 * @param transactions — Transacciones del período.
 * @returns GST neto en centavos (positivo = a pagar, negativo = reembolso).
 */
export function calculateGstNetFromTransactions(
  transactions: TaxableTransaction[],
): number {
  return (
    calculateGstCollectedFromTransactions(transactions) -
    calculateGstInputCreditsFromTransactions(transactions)
  );
}

/**
 * Calcula el PST total cobrado en ventas a partir de transacciones.
 *
 * @param transactions — Transacciones del período.
 * @returns PST cobrado en centavos.
 */
export function calculatePstCollectedFromTransactions(
  transactions: TaxableTransaction[],
): number {
  return transactions
    .filter((t) => t.tipo === "venta")
    .reduce((sum, t) => sum + t.pst_cents, 0);
}

/**
 * Calcula el PST neto a remitir desde transacciones.
 *
 * En BC no hay input credits para PST.
 *
 * @param transactions — Transacciones del período.
 * @returns PST neto en centavos.
 */
export function calculatePstNetFromTransactions(
  transactions: TaxableTransaction[],
): number {
  return calculatePstCollectedFromTransactions(transactions);
}

// =========================================================================
// Tax amounts from base (convenience)
// =========================================================================

/**
 * Calcula el monto de GST a partir de una base imponible.
 *
 * @param baseCents — Monto base en centavos.
 * @returns GST en centavos (redondeado al entero más cercano).
 */
export function gstFromBase(baseCents: number): number {
  return Math.round(baseCents * GST_RATE);
}

/**
 * Calcula el monto de PST a partir de una base imponible.
 *
 * @param baseCents — Monto base en centavos.
 * @returns PST en centavos (redondeado al entero más cercano).
 */
export function pstFromBase(baseCents: number): number {
  return Math.round(baseCents * PST_RATE);
}

// =========================================================================
// Tax obligation builder
// =========================================================================

/**
 * Construye el objeto TaxObligation para un período y tipo de impuesto.
 *
 * @param periodo — Período contable YYYY-MM.
 * @param tipo — "GST" o "PST".
 * @param collected — Impuesto cobrado en ventas, en centavos.
 * @param inputCredits — ITCs (solo aplica para GST; 0 para PST).
 * @param fechaVencimiento — Fecha límite de declaración (ISO 8601).
 * @param adminId — UUID del admin que genera la obligación.
 * @returns TaxObligation validado con Zod.
 */
export function buildTaxObligation(
  periodo: string,
  tipo: TaxType,
  collected: number,
  inputCredits: number,
  fechaVencimiento: string,
  adminId: string,
): TaxObligation {
  const neto = tipo === "GST" ? collected - inputCredits : collected;

  return TaxObligationSchema.parse({
    obligacion_id: crypto.randomUUID(),
    periodo,
    tipo,
    collected,
    input_credits: inputCredits,
    neto,
    fecha_vencimiento: fechaVencimiento,
    estado: "PENDIENTE" as const,
    fecha_declaracion: null,
    admin_id: adminId,
  });
}

// =========================================================================
// Tax Journal Entry generation (devengo)
// =========================================================================

/**
 * Genera un asiento contable de devengo de impuestos para el período.
 *
 * Produce DOS eventos separados (uno para GST, otro para PST), cada uno
 * generando 2 filas (débito + crédito) en el Financial Ledger:
 *
 * Asiento GST:
 *   Débito:  INGRESOS_SERVICIOS_4010 (4-4010) — reduce el ingreso neto
 *   Crédito: GST_PAYABLE (2-2020) — pasivo con CRA
 *
 * Asiento PST:
 *   Débito:  INGRESOS_SERVICIOS_4010 (4-4010) — reduce el ingreso neto
 *   Crédito: PST_PAYABLE (2-2030) — pasivo con BC Ministry of Finance
 *
 * @param periodo — Período contable YYYY-MM.
 * @param gstNetCents — GST neto a devengar (calculateGstNet).
 * @param pstNetCents — PST neto a devengar (calculatePstNet).
 * @param userId — UUID del admin que ejecuta el devengo.
 * @returns Array de JournalEntryRow (4 filas: 2 para GST + 2 para PST).
 */
export function generateTaxAccrualJournalEntry(
  periodo: string,
  gstNetCents: number,
  pstNetCents: number,
  userId: string,
): JournalEntryRow[] {
  const rows: JournalEntryRow[] = [];
  const timestamp = new Date().toISOString();

  // ── GST Accrual ────────────────────────────────────────────────────
  if (gstNetCents > 0) {
    const gstEvent: BusinessEvent = {
      event_id: crypto.randomUUID(),
      event_type: "tax_gst_accrual",
      order_id: null,
      user_id: userId,
      amount_cents: gstNetCents,
      currency: "CAD",
      processor: "internal",
      external_reference: `gst-accrual-${periodo}`,
      occurred_at: timestamp,
      metadata: { periodo, tax_type: "GST", net_cents: gstNetCents },
    };
    rows.push(...generateJournalEntry(gstEvent));
  }

  // ── PST Accrual ────────────────────────────────────────────────────
  if (pstNetCents > 0) {
    const pstEvent: BusinessEvent = {
      event_id: crypto.randomUUID(),
      event_type: "tax_pst_accrual",
      order_id: null,
      user_id: userId,
      amount_cents: pstNetCents,
      currency: "CAD",
      processor: "internal",
      external_reference: `pst-accrual-${periodo}`,
      occurred_at: timestamp,
      metadata: { periodo, tax_type: "PST", net_cents: pstNetCents },
    };
    rows.push(...generateJournalEntry(pstEvent));
  }

  return rows;
}

// =========================================================================
// recordTaxObligation — create obligation + JE
// =========================================================================

/**
 * Resultado de recordTaxObligation: la obligación fiscal y los asientos
 * contables de devengo generados.
 */
export interface TaxObligationRecord {
  /** La obligación fiscal creada (para insertar en obligacion_impuesto). */
  obligation: TaxObligation;
  /** Filas del Journal Entry a insertar en financial_ledger. */
  journalEntries: JournalEntryRow[];
}

/**
 * Crea el registro de obligación fiscal para un período y tipo de impuesto,
 * y genera el asiento contable de devengo correspondiente.
 *
 * Flujo:
 *  1. Calcula collected, input_credits y neto desde las filas del ledger.
 *  2. Construye el objeto TaxObligation con estado PENDIENTE.
 *  3. Genera el JE de devengo:
 *     - GST: Débito 4-4010 (Revenue contra) → Crédito 2-2020 (GST Payable)
 *     - PST: Débito 4-4010 (Revenue contra) → Crédito 2-2030 (PST Payable)
 *
 * El caller debe insertar `obligation` en la tabla `obligacion_impuesto` y
 * las `journalEntries` en `financial_ledger` dentro de la misma transacción DB.
 *
 * @param rows — Filas del ledger pre-filtradas por periodo_contable.
 * @param periodo — Período contable YYYY-MM.
 * @param tipo — "GST" o "PST".
 * @param fechaVencimiento — Fecha límite de declaración (ISO 8601).
 * @param adminId — UUID del admin que genera la obligación.
 * @returns TaxObligationRecord con la obligación y los asientos contables.
 */
export function recordTaxObligation(
  rows: JournalEntryRow[],
  periodo: string,
  tipo: TaxType,
  fechaVencimiento: string,
  adminId: string,
): TaxObligationRecord {
  const collected =
    tipo === "GST"
      ? calculateGstCollected(rows, periodo)
      : calculatePstCollected(rows, periodo);

  const inputCredits =
    tipo === "GST" ? calculateGstInputCredits(rows, periodo) : 0;

  const obligation = buildTaxObligation(
    periodo,
    tipo,
    collected,
    inputCredits,
    fechaVencimiento,
    adminId,
  );

  const neto = obligation.neto;

  const journalEntries =
    tipo === "GST"
      ? generateTaxAccrualJournalEntry(periodo, neto, 0, adminId)
      : generateTaxAccrualJournalEntry(periodo, 0, neto, adminId);

  return { obligation, journalEntries };
}

// =========================================================================
// Determine filing frequency
// =========================================================================

/**
 * Determina la frecuencia de declaración de GST según el revenue anual.
 *
 * Reglas CRA:
 *  - Revenue anual < $3,000,000 → declaración trimestral
 *  - Revenue anual ≥ $3,000,000 → declaración mensual
 *
 * @param annualRevenueCents — Revenue anual estimado/proyectado en centavos.
 * @returns "trimestral" o "mensual".
 */
export function getFilingFrequency(
  annualRevenueCents: number,
): "trimestral" | "mensual" {
  return annualRevenueCents >= MONTHLY_FILING_THRESHOLD_CAD * 100
    ? "mensual"
    : "trimestral";
}

/**
 * Determina si un negocio califica como "small supplier" y por tanto
 * está exento de registrarse para GST.
 *
 * @param trailingFourQuartersRevenueCents — Revenue de los últimos 4 trimestres.
 * @returns true si está por debajo del umbral de $30,000.
 */
export function isSmallSupplier(
  trailingFourQuartersRevenueCents: number,
): boolean {
  return trailingFourQuartersRevenueCents < SMALL_SUPPLIER_THRESHOLD_CAD * 100;
}

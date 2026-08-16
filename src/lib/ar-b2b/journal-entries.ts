/**
 * AR B2B — Journal entries module.
 *
 * Asientos contables para el ciclo AR B2B: emisión de factura y cobro.
 */
import { createHash } from "@/lib/crypto.server";
import {
  generateJournalEntry,
  CHART_OF_ACCOUNTS,
  JournalEntryRowSchema,
  type BusinessEvent,
  type CuentaContable,
  type JournalEntryRow,
  type LedgerEntryStatus,
} from "@/lib/financial-ledger";
import { type Factura, applyPayment } from "./invoice";

// =========================================================================
// Row hash
// =========================================================================

/**
 * Calcula SHA-256 para una fila del ledger usando el mismo algoritmo
 * canónico que financial-ledger.ts (campos concatenados con `|`).
 */
function computeRowHash(row: Omit<JournalEntryRow, "hash_sha256">): string {
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

// =========================================================================
// Invoice journal entry
// =========================================================================

/**
 * Genera el asiento contable completo por la emisión de una factura B2B.
 *
 * Asiento de 4 filas (partida doble con desglose impositivo):
 *   Débito:  CUENTAS_POR_COBRAR_AR (1-1020) — activo, derecho de cobro — TOTAL
 *   Crédito: INGRESOS_SERVICIOS_4010 (4-4010) — ingreso devengado — SUBTOTAL
 *   Crédito: GST_PAYABLE (2-2020) — GST 5% cobrado al cliente
 *   Crédito: PST_PAYABLE (2-2030) — PST 7% cobrado al cliente
 *
 * Invariante: subtotal + gst_cents + pst_cents = total → SUM(débito) = SUM(crédito)
 *
 * @param factura — Factura emitida con desglose impositivo.
 * @param userId — UUID del usuario que genera la factura.
 * @returns Array de JournalEntryRow (4 filas: 1 débito + 3 crédito).
 */
export function generateInvoiceJournalEntry(
  factura: Factura,
  userId: string,
): JournalEntryRow[] {
  const ledgerId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const timestamp = `${factura.fecha_emision}T00:00:00.000Z`;
  const periodo = factura.fecha_emision.slice(0, 7);
  const referencia = {
    factura_id: factura.factura_id,
    cliente_id: factura.cliente_id,
    orden_id: factura.orden_id,
    lineas_count: factura.lineas.length,
    // referencia se serializa a JSONB (persistencia): número entero de centavos.
    subtotal_cents: Number(factura.subtotal),
    gst_cents: Number(factura.gst_cents),
    pst_cents: Number(factura.pst_cents),
  };

  const rows: Omit<JournalEntryRow, "hash_sha256">[] = [
    // 1. DÉBITO: Cuentas por Cobrar AR (activo) — monto total de la factura
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR_AR as CuentaContable,
      cuenta_credito: null,
      // Borde del ledger (Capa 0): monto sigue tipado number en ledger-types.
      monto: Number(factura.total),
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — AR [DÉBITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
    // 2. CRÉDITO: Ingresos por Servicios (revenue) — subtotal sin impuestos
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010 as CuentaContable,
      monto: Number(factura.subtotal),
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — Revenue [CRÉDITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
    // 3. CRÉDITO: GST Payable — 5% cobrado pendiente de remitir a CRA
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: CHART_OF_ACCOUNTS.GST_PAYABLE as CuentaContable,
      monto: Number(factura.gst_cents),
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — GST 5% [CRÉDITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
    // 4. CRÉDITO: PST Payable — 7% BC cobrado pendiente de remitir
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: CHART_OF_ACCOUNTS.PST_PAYABLE as CuentaContable,
      monto: Number(factura.pst_cents),
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — PST 7% [CRÉDITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
  ];

  // Validar invariante contable: SUM(débito) = SUM(crédito)
  const sumDebito = rows
    .filter((r) => r.cuenta_debito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  const sumCredito = rows
    .filter((r) => r.cuenta_credito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  if (sumDebito !== sumCredito) {
    throw new Error(
      `generateInvoiceJournalEntry: invariante contable rota — SUM(débito)=${sumDebito} ≠ SUM(crédito)=${sumCredito}`
    );
  }

  // Calcular hash SHA-256 de cada fila y validar con Zod
  return rows.map((row) => {
    const hash = computeRowHash(row);
    return JournalEntryRowSchema.parse({ ...row, hash_sha256: hash });
  });
}

// =========================================================================
// Payment journal entry
// =========================================================================

/**
 * Genera el asiento contable por el cobro de una factura B2B (pago recibido).
 *
 * Asiento:
 *   Débito:  EFECTIVO (1-1000) — entra dinero
 *   Crédito: CUENTAS_POR_COBRAR_AR (1-1020) — se liquida el derecho de cobro
 *
 * @param factura — Factura que se está cobrando (para referencia).
 * @param amountCents — Monto recibido en centavos.
 * @param userId — UUID del usuario que registra el cobro.
 * @param paymentReference — Referencia externa del pago (ej. transaction_id del banco).
 * @returns Array de JournalEntryRow (2 filas: débito + crédito).
 */
export function generatePaymentJournalEntry(
  factura: Factura,
  amountCents: bigint,
  userId: string,
  paymentReference?: string,
): JournalEntryRow[] {
  const event: BusinessEvent = {
    event_id: crypto.randomUUID(),
    event_type: "ar_payment_received",
    order_id: factura.orden_id,
    user_id: userId,
    // Borde del ledger (Capa 0): amount_cents sigue tipado number.
    amount_cents: Number(amountCents),
    currency: "CAD",
    processor: "internal",
    external_reference: paymentReference ?? factura.factura_id,
    occurred_at: new Date().toISOString(),
    metadata: {
      factura_id: factura.factura_id,
      cliente_id: factura.cliente_id,
    },
  };

  return generateJournalEntry(event);
}

/**
 * Registra un pago sobre una factura B2B: actualiza el saldo pendiente
 * y genera el asiento contable correspondiente.
 *
 * Asiento contable del cobro:
 *   Débito:  EFECTIVO (1-1000) — entra dinero
 *   Crédito: CUENTAS_POR_COBRAR_AR (1-1020) — se liquida el derecho de cobro
 *
 * @param factura — Factura original (no se modifica; se devuelve copia actualizada).
 * @param monto — Monto del pago en centavos.
 * @param metodo — Método de pago (ej. "transferencia", "cheque", "efectivo").
 * @param referencia — Referencia externa o identificador del pago.
 * @param userId — UUID del usuario que registra el cobro.
 * @returns Factura actualizada + filas del asiento contable de cobro.
 */
export function recordPayment(
  factura: Factura,
  monto: bigint,
  metodo: string,
  referencia: string,
  userId: string,
): { factura: Factura; journalEntries: JournalEntryRow[] } {
  const facturaActualizada = applyPayment(factura, monto);
  const journalEntries = generatePaymentJournalEntry(
    factura,
    monto,
    userId,
    referencia,
  );
  return { factura: facturaActualizada, journalEntries };
}

/**
 * billing-to-ledger.ts — Puente entre Client Billing y Financial Ledger.
 *
 * Convierte facturas y pagos del módulo de clientes (`client-module/`) en
 * `BusinessEvent` que el Financial Ledger (`financial-ledger.ts`) puede
 * procesar vía `generateJournalEntry()`.
 *
 * Actualmente estos dos sistemas operan en universos paralelos:
 *   - Billing: client_invoices + client_payments (client-module/)
 *   - Contabilidad: financial_ledger (financial-ledger.ts)
 *
 * Este puente cierra esa brecha: cada factura emitida se traduce a un evento
 * `client_invoice_generated` (devengo de revenue) y cada pago registrado a un
 * evento `client_payment_received` (cobro contra AR). Ambos tipos de evento
 * ya están mapeados en EVENT_ACCOUNT_MAP dentro de financial-ledger.ts, así
 * que `generateJournalEntry()` los procesa sin cambios adicionales.
 *
 * Principios:
 *  - Funciones puras: no tocan base de datos. El caller es responsable de
 *    insertar las filas del JournalEntry en financial_ledger.
 *  - Type-only imports desde financial-ledger.ts para evitar dependencia
 *    circular: este módulo no importa código runtime de client-module/.
 *  - Los tipos ClientInvoice / ClientPayment se definen aquí como contrato
 *    mínimo de las tablas de DB (documentado en client-module/invoice-service.ts
 *    y client-module/payment-service.ts). NO se importan de client-module/
 *    para no crear dependencia runtime en esa dirección.
 *
 * Asientos contables generados:
 *
 *   Factura (client_invoice_generated):
 *     Débito:  CUENTAS_POR_COBRAR (1-1100) — derecho de cobro
 *     Crédito: INGRESOS_SERVICIOS (4-1000)  — ingreso por servicios
 *
 *   Pago (client_payment_received):
 *     Débito:  EFECTIVO (1-1000)            — entra dinero
 *     Crédito: CUENTAS_POR_COBRAR (1-1100)  — se liquida el derecho de cobro
 *
 * GST/PST:
 *   Los montos de GST y PST ya vienen precalculados en la factura desde
 *   billing-calculations.ts (fuente canónica). No se devengan aquí — el Tax
 *   Engine (tax-engine.ts) calcula la obligación fiscal al cierre del período
 *   contable a partir de los montos registrados en el ledger.
 */

import {
  generateJournalEntry,
  type BusinessEvent,
  type JournalEntryRow,
} from "@/lib/financial-ledger";

// ---------------------------------------------------------------------------
// Tipos mínimos — contrato de DB del módulo de clientes
// ---------------------------------------------------------------------------

/**
 * Contrato de `client_invoices` (subconjunto relevante para el puente).
 *
 * Definido aquí —no importado de client-module/types.ts— para mantener
 * independencia de módulos: este puente NO importa código runtime del
 * módulo de clientes.
 *
 * Columnas según el contrato documentado en client-module/invoice-service.ts:
 *   id, client_id, invoice_number, issue_date, due_date, status,
 *   subtotal_cents, gst_amount_cents, pst_amount_cents, total_cents,
 *   amount_paid_cents, balance_due_cents, created_at, updated_at
 */
export interface ClientInvoice {
  /** UUID — primary key de client_invoices. */
  id: string;
  /** UUID — foreign key a clients.id. */
  client_id: string;
  /** Número de factura formateado (ej. "INV-2026-000123"). */
  invoice_number: string;
  /** Fecha de emisión (ISO 8601 date-only o timestamp). */
  issue_date: string;
  /** Fecha de vencimiento (ISO 8601 date-only o timestamp). */
  due_date: string;
  /**
   * Estado de la factura.
   * "draft" | "sent" | "paid" | "partially_paid" | "overdue" | "void"
   */
  status: string;
  /** Subtotal antes de impuestos, en centavos. */
  subtotal_cents: number;
  /** GST (5% federal) calculado sobre el subtotal, en centavos. */
  gst_amount_cents: number;
  /** PST (7% BC provincial) calculado sobre el subtotal, en centavos. */
  pst_amount_cents: number;
  /** Total facturado (subtotal + GST + PST), en centavos. */
  total_cents: number;
  /** Monto ya pagado hasta el momento, en centavos. */
  amount_paid_cents: number;
  /** Saldo pendiente de cobro (total - amount_paid), en centavos. */
  balance_due_cents: number;
}

/**
 * Contrato de `client_payments` (subconjunto relevante para el puente).
 *
 * Definido aquí —no importado de client-module/— por la misma razón que
 * ClientInvoice: independencia de módulos, sin dependencia runtime.
 *
 * Columnas según el contrato documentado en client-module/payment-service.ts:
 *   id, client_id, invoice_id, payment_method_id, amount_cents,
 *   payment_date (TIMESTAMPTZ), provider_reference, status, created_at
 */
export interface ClientPayment {
  /** UUID — primary key de client_payments. */
  id: string;
  /** UUID — foreign key a clients.id. */
  client_id: string;
  /** UUID — foreign key a client_invoices.id. */
  invoice_id: string;
  /** UUID opcional — foreign key a payment_methods.id. */
  payment_method_id: string | null;
  /** Monto del pago en centavos. */
  amount_cents: number;
  /** Fecha y hora del pago (TIMESTAMPTZ como string ISO 8601). */
  payment_date: string;
  /** Referencia externa del procesador de pago (Stripe/PayPal transaction ID). */
  provider_reference: string | null;
  /**
   * Estado del pago.
   * "pending" | "completed" | "failed" | "refunded"
   */
  status: string;
}

// ---------------------------------------------------------------------------
// translateInvoiceToJournalEntry
// ---------------------------------------------------------------------------

/**
 * Convierte una factura de cliente en un `BusinessEvent` que
 * `generateJournalEntry()` puede procesar para registrar el devengo contable.
 *
 * El evento generado (`client_invoice_generated`) produce el siguiente
 * asiento de partida doble:
 *
 * ```
 *   Débito:  CUENTAS_POR_COBRAR (1-1100) — se reconoce el derecho de cobro
 *   Crédito: INGRESOS_SERVICIOS (4-1000)  — se reconoce el ingreso devengado
 * ```
 *
 * El monto (`amount_cents`) es `invoice.subtotal_cents` (ingreso neto sin
 * impuestos). GST y PST no se devengan aquí — se registran en `metadata`
 * para que el Tax Engine (`tax-engine.ts`) los procese al cierre del período.
 *
 * @param invoice — Factura de cliente (fila de `client_invoices`).
 * @returns `BusinessEvent` listo para `generateJournalEntry()`.
 *
 * @example
 * ```ts
 * const event = translateInvoiceToJournalEntry(invoice);
 * const journalRows = generateJournalEntry(event);
 * await supabase.from("financial_ledger").insert(journalRows);
 * ```
 */
export function translateInvoiceToJournalEntry(
  invoice: ClientInvoice,
): BusinessEvent {
  return {
    event_id: crypto.randomUUID(),
    event_type: "client_invoice_generated",
    order_id: invoice.id,
    user_id: invoice.client_id,
    amount_cents: invoice.subtotal_cents,
    currency: "CAD",
    processor: "internal",
    external_reference: invoice.invoice_number,
    occurred_at: invoice.issue_date,
    metadata: {
      source: "client-module",
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      client_id: invoice.client_id,
      subtotal_cents: invoice.subtotal_cents,
      gst_amount_cents: invoice.gst_amount_cents,
      pst_amount_cents: invoice.pst_amount_cents,
      total_cents: invoice.total_cents,
      invoice_status: invoice.status,
      due_date: invoice.due_date,
    },
  };
}

// ---------------------------------------------------------------------------
// translatePaymentToJournalEntry
// ---------------------------------------------------------------------------

/**
 * Convierte un pago de cliente en un `BusinessEvent` que
 * `generateJournalEntry()` puede procesar para registrar el cobro.
 *
 * El evento generado (`client_payment_received`) produce el siguiente
 * asiento de partida doble:
 *
 * ```
 *   Débito:  EFECTIVO (1-1000)            — entra dinero a la empresa
 *   Crédito: CUENTAS_POR_COBRAR (1-1100)  — se liquida total o parcialmente
 *                                            el derecho de cobro
 * ```
 *
 * @param payment — Pago de cliente (fila de `client_payments`).
 * @returns `BusinessEvent` listo para `generateJournalEntry()`.
 *
 * @example
 * ```ts
 * const event = translatePaymentToJournalEntry(payment);
 * const journalRows = generateJournalEntry(event);
 * await supabase.from("financial_ledger").insert(journalRows);
 * ```
 */
export function translatePaymentToJournalEntry(
  payment: ClientPayment,
): BusinessEvent {
  return {
    event_id: crypto.randomUUID(),
    event_type: "client_payment_received",
    order_id: payment.invoice_id,
    user_id: payment.client_id,
    amount_cents: payment.amount_cents,
    currency: "CAD",
    processor: "internal",
    external_reference: payment.provider_reference ?? payment.id,
    occurred_at: payment.payment_date,
    metadata: {
      source: "client-module",
      payment_id: payment.id,
      invoice_id: payment.invoice_id,
      client_id: payment.client_id,
      payment_status: payment.status,
      provider_reference: payment.provider_reference,
      payment_method_id: payment.payment_method_id,
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: full pipeline (translate + generate journal entries)
// ---------------------------------------------------------------------------

/**
 * Traduce una factura de cliente y genera las filas del libro mayor
 * directamente.
 *
 * Equivale a `generateJournalEntry(translateInvoiceToJournalEntry(invoice))`.
 * Produce 2 filas (una débito, una crédito) con el mismo `ledger_id`.
 *
 * @param invoice — Factura de cliente.
 * @returns Array de `JournalEntryRow` (2 filas: débito + crédito).
 */
export function generateInvoiceJournalEntry(
  invoice: ClientInvoice,
): JournalEntryRow[] {
  return generateJournalEntry(translateInvoiceToJournalEntry(invoice));
}

/**
 * Traduce un pago de cliente y genera las filas del libro mayor directamente.
 *
 * Equivale a `generateJournalEntry(translatePaymentToJournalEntry(payment))`.
 * Produce 2 filas (una débito, una crédito) con el mismo `ledger_id`.
 *
 * @param payment — Pago de cliente.
 * @returns Array de `JournalEntryRow` (2 filas: débito + crédito).
 */
export function generatePaymentJournalEntry(
  payment: ClientPayment,
): JournalEntryRow[] {
  return generateJournalEntry(translatePaymentToJournalEntry(payment));
}

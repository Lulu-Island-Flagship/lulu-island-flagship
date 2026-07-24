/**
 * v8.3 E2.5 / C.2.4 / C.3 — Shadow Ledger.
 *
 * "Registro operativo de toda transacción, separado de QBO, fuente de
 * verdad operativa cuando QBO no responde" (E2.5). "Si QBO cae, el sistema
 * opera con Shadow Ledger y sincroniza al volver" (C.2.4, degradación
 * elegante).
 *
 * Esta función es pura: arma el objeto a insertar en `shadow_ledger_entries`
 * (migración 081) a partir de los datos de un evento de dinero real. No
 * toca la base de datos ni Stripe/PayPal — el caller hace el INSERT.
 *
 * QUÉ DEBE LOGUEARSE (contrato para todo caller nuevo):
 *   1. Todo evento de dinero real que ya ocurrió en el procesador (Stripe/
 *      PayPal) — nunca un evento "planeado" o "proyectado". Ejemplos reales
 *      hoy en el código: captura de Hold (batch-capture, cancel), captura
 *      de saldo (batch-capture), captura de penalidad de cancelación
 *      (cancel), liberación de Hold (cancel >72h), anticipo PayPal
 *      (hold-authorize), fallo de captura (batch-capture catch block).
 *   2. SIEMPRE con `idempotencyKey` determinístico — mismo evento externo
 *      reintentado no debe duplicar fila (constraint UNIQUE en DB). Usar
 *      `buildIdempotencyKey` de este archivo.
 *   3. El registro se escribe en el mismo request que ejecuta el cobro,
 *      ANTES o en paralelo al intento de exportar a QBO — nunca depende de
 *      que QBO responda. Si el INSERT del Shadow Ledger fallara, eso sí es
 *      un error crítico (es la fuente de verdad); un fallo de QBO no lo es.
 *   4. `sync_status` nace en 'pending_qbo_sync' siempre. La transición a
 *      'synced' / 'sync_failed' la hace el job de conciliación QBO (E2.6,
 *      no construido en esta sesión) — no el caller que registra el cobro.
 */

export type ShadowLedgerEventType =
  | "hold_authorized"
  | "hold_captured"
  | "hold_released"
  | "balance_captured"
  | "cancellation_penalty"
  | "paypal_advance_received"
  | "paypal_refund"
  | "capture_failed"
  | "warranty_refund"
  | "wallet_full_payment_received"
  | "wallet_refund";

export type ShadowLedgerProcessor = "stripe" | "paypal" | "internal";

export interface BuildShadowLedgerEntryInput {
  eventType: ShadowLedgerEventType;
  orderId: string | null;
  userId: string | null;
  amountCents: number;
  currency?: string;
  processor: ShadowLedgerProcessor;
  externalReference: string | null;
  occurredAt: Date | string;
  metadata?: Record<string, unknown>;
}

export interface ShadowLedgerEntryRecord {
  event_type: ShadowLedgerEventType;
  order_id: string | null;
  user_id: string | null;
  amount_cents: number;
  currency: string;
  payment_processor: ShadowLedgerProcessor;
  external_reference: string | null;
  idempotency_key: string;
  occurred_at: string;
  sync_status: "pending_qbo_sync";
  metadata: Record<string, unknown>;
}

/**
 * Idempotency key determinística: mismo evento + misma referencia externa
 * (o misma orden si no hay referencia externa, p.ej. un 'capture_failed'
 * sin PaymentIntent) siempre produce la misma clave.
 */
export function buildIdempotencyKey(input: {
  eventType: ShadowLedgerEventType;
  externalReference: string | null;
  orderId: string | null;
}): string {
  const scope = input.externalReference ?? input.orderId ?? "no-reference";
  return `${input.eventType}:${scope}`;
}

export function buildShadowLedgerEntry(
  input: BuildShadowLedgerEntryInput
): ShadowLedgerEntryRecord {
  if (input.amountCents < 0) {
    throw new Error(
      `Shadow Ledger amountCents debe ser >= 0 (magnitud), la dirección la da event_type. Recibido: ${input.amountCents}`
    );
  }

  const occurredAt =
    typeof input.occurredAt === "string" ? input.occurredAt : input.occurredAt.toISOString();

  return {
    event_type: input.eventType,
    order_id: input.orderId,
    user_id: input.userId,
    amount_cents: Math.round(input.amountCents),
    currency: input.currency ?? "cad",
    payment_processor: input.processor,
    external_reference: input.externalReference,
    idempotency_key: buildIdempotencyKey({
      eventType: input.eventType,
      externalReference: input.externalReference,
      orderId: input.orderId,
    }),
    occurred_at: occurredAt,
    sync_status: "pending_qbo_sync",
    metadata: input.metadata ?? {},
  };
}

/**
 * Reconstruye el estado financiero operativo de una orden a partir de sus
 * entradas del Shadow Ledger, sin depender de QBO ni de las columnas
 * mutables de `orders` (que se sobrescriben en cada evento). Útil para el
 * criterio de aceptación "el sistema opera 48h con Shadow Ledger y
 * reconcilia al volver sin duplicar" — esta función es la lectura pura que
 * un job de reconciliación usaría para comparar contra QBO.
 */
export interface LedgerEntryForReplay {
  event_type: ShadowLedgerEventType;
  amount_cents: number;
}

export interface ReplayedOrderBalance {
  totalCollectedCents: number;
  totalRefundedCents: number;
  netCents: number;
}

export function replayOrderBalance(entries: LedgerEntryForReplay[]): ReplayedOrderBalance {
  const REFUND_EVENTS: ShadowLedgerEventType[] = [
    "hold_released",
    "paypal_refund",
    "warranty_refund",
    "wallet_refund",
  ];
  const COLLECTION_EVENTS: ShadowLedgerEventType[] = [
    "hold_captured",
    "balance_captured",
    "cancellation_penalty",
    "paypal_advance_received",
    "wallet_full_payment_received",
  ];

  let totalCollectedCents = 0;
  let totalRefundedCents = 0;

  for (const entry of entries) {
    if (COLLECTION_EVENTS.includes(entry.event_type)) {
      totalCollectedCents += entry.amount_cents;
    } else if (REFUND_EVENTS.includes(entry.event_type)) {
      totalRefundedCents += entry.amount_cents;
    }
    // hold_authorized y capture_failed no mueven dinero real; se ignoran
    // en el balance (son informativos/de auditoría).
  }

  return {
    totalCollectedCents,
    totalRefundedCents,
    netCents: totalCollectedCents - totalRefundedCents,
  };
}

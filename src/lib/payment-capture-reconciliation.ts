import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = SupabaseClient<any, "public", any>;

/**
 * v8.3 M-2 (auditoría implacable 2026-07-20b) — reconciliación de capturas.
 *
 * Las 6 rutas que capturan pagos en Stripe (force-full-capture, cancel,
 * batch-capture-retry, no-show, batch-capture x2) hacen la captura y
 * ESCRIBEN el resultado en `orders` en la misma request/función síncrona. Si
 * la respuesta HTTP de Stripe se pierde después de que la captura realmente
 * tuvo éxito (timeout de red, cold start matado a mitad, etc.), esa fila de
 * `orders` nunca se actualiza aunque Stripe sí cobró — no había ningún
 * mecanismo que reconciliara el estado local contra la verdad de Stripe.
 *
 * Este módulo centraliza esa reconciliación en un solo lugar para que la
 * use tanto el webhook (`payment_intent.succeeded`, reacciona en tiempo
 * real) como el cron de red de seguridad (`cron/reconcile-payments`,
 * corrige cualquier caso que el webhook también haya perdido). Evita
 * duplicar el mapeo de campos en dos sitios.
 *
 * Idempotente por diseño: cada rama solo escribe si el campo que marca
 * "esto ya se reflejó localmente" (`hold_captured_at` / `capture_captured_at`)
 * sigue en null, con un guard optimista (`.is(...)` en el propio UPDATE) para
 * que una carrera entre el webhook y el cron no pise la misma fila dos veces.
 */

export interface ReconcilablePaymentIntent {
  id: string;
  /** Monto realmente cobrado por Stripe, en centavos (payment_intent.amount_received). */
  amountReceivedCents: number;
  /** metadata.order_id del PaymentIntent -- todas las creaciones de PI de este proyecto la setean. */
  orderId: string | null | undefined;
}

export interface ReconcileResult {
  /** true si esta llamada efectivamente escribió algo en `orders`. */
  updated: boolean;
  orderId?: string;
  reason: string;
}

interface OrderCaptureRow {
  id: string;
  stripe_hold_payment_intent_id: string | null;
  stripe_capture_payment_intent_id: string | null;
  hold_captured_at: string | null;
  capture_captured_at: string | null;
  capture_authorized_amount: number | null;
  total_paid: number | null;
  card_amount_charged: number | null;
}

/**
 * Marca una orden como capturada a partir de un PaymentIntent que Stripe ya
 * confirmó `succeeded`, SOLO si el estado local todavía no lo refleja.
 * Reusado por el webhook (case "payment_intent.succeeded") y por el cron de
 * reconciliación (src/app/api/cron/reconcile-payments/route.ts).
 */
export async function reconcileCapturedPaymentIntent(
  supabase: SupabaseAdmin,
  paymentIntent: ReconcilablePaymentIntent
): Promise<ReconcileResult> {
  const orderId = paymentIntent.orderId;
  if (!orderId) {
    return { updated: false, reason: "PaymentIntent sin metadata.order_id" };
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, stripe_hold_payment_intent_id, stripe_capture_payment_intent_id, hold_captured_at, capture_captured_at, capture_authorized_amount, total_paid, card_amount_charged"
    )
    .eq("id", orderId)
    .limit(1);

  const order = (orders?.[0] as OrderCaptureRow | undefined) ?? undefined;
  if (!order) {
    return { updated: false, reason: `Order ${orderId} no encontrada` };
  }

  const amountDollars = Math.round(paymentIntent.amountReceivedCents ?? 0) / 100;

  // Caso 1: el PI que tuvo éxito ES el Hold (capturado vía .capture() en
  // alguno de los 6 call sites). El campo que marca "ya reflejado" es
  // hold_captured_at -- mismo campo que escriben esos call sites tras un
  // .capture() exitoso.
  if (order.stripe_hold_payment_intent_id === paymentIntent.id) {
    if (order.hold_captured_at) {
      return { updated: false, orderId: order.id, reason: "hold_captured_at ya seteado" };
    }
    const { error } = await supabase
      .from("orders")
      .update({
        hold_captured_at: new Date().toISOString(),
        capture_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .is("hold_captured_at", null);

    if (error) {
      return { updated: false, orderId: order.id, reason: `Update error: ${error.message}` };
    }
    return { updated: true, orderId: order.id, reason: "hold_captured_at reconciliado" };
  }

  // Caso 2: el PI que tuvo éxito es el cobro de saldo/excedente (balance,
  // paypal_balance, partial_capture_excess -- todos creados con
  // confirm:true, off_session, y metadata.order_id). El campo que marca "ya
  // reflejado" es capture_captured_at -- mismo campo que escriben esos call
  // sites tras un PaymentIntent de saldo exitoso.
  if (order.capture_captured_at) {
    return { updated: false, orderId: order.id, reason: "capture_captured_at ya seteado" };
  }

  const { error } = await supabase
    .from("orders")
    .update({
      stripe_capture_payment_intent_id: paymentIntent.id,
      capture_captured_at: new Date().toISOString(),
      // Reconciliación best-effort: si el write síncrono se perdió, los
      // valores previos son el estado "antes" de este cobro -- se suman en
      // vez de sobreescribir, igual que hacen los call sites originales al
      // acumular hold + saldo en total_paid/card_amount_charged.
      capture_authorized_amount: (order.capture_authorized_amount || 0) + amountDollars,
      total_paid: (order.total_paid || 0) + amountDollars,
      card_amount_charged: (order.card_amount_charged || 0) + amountDollars,
      capture_attempts: 0,
      capture_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .is("capture_captured_at", null);

  if (error) {
    return { updated: false, orderId: order.id, reason: `Update error: ${error.message}` };
  }
  return { updated: true, orderId: order.id, reason: "capture_captured_at reconciliado" };
}

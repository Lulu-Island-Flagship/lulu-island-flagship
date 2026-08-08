import type { SupabaseClient } from "@supabase/supabase-js";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { generateJournalEntry } from "@/lib/journal-entry";
import type { BusinessEvent } from "@/lib/ledger-types";
import { captureError } from "@/lib/observability";

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
  /**
   * metadata.charge_type del PaymentIntent, si existe. Ver fix (auditoría
   * externa, verificado 2026-07-31) más abajo en BALANCE_CAPTURE_CHARGE_TYPES
   * -- necesario para que Caso 2 no confunda un PI que NO es un cobro de
   * saldo estándar (ej. installment_second_payment, force_full_capture,
   * penalizaciones) con uno que sí lo es.
   */
  chargeType?: string | null;
}

// Fix (auditoría externa, verificado 2026-07-31, hallazgo real y de mayor
// alcance de lo reportado): Caso 2 (más abajo) trataba CUALQUIER PaymentIntent
// exitoso que no fuera el hold como "cobro de saldo", sumándolo a
// total_paid_cents/card_amount_charged_cents y marcando capture_captured_at.
// Pero solo DOS rutas (cron/batch-capture y cron/batch-capture-retry, charge_type
// "balance"/"paypal_balance"/"balance_retry_10pm"/"paypal_balance_retry_10pm")
// escriben esos DOS campos de forma síncrona -- son las únicas para las que
// esta reconciliación es un respaldo legítimo de "se perdió la respuesta
// pero el cobro sí ocurrió".
//
// Todas las demás rutas que crean un PaymentIntent con metadata.order_id
// (force-full-capture, capture-remainder, installment-second-capture,
// no-show penalty, cancel penalty) tienen SUS PROPIOS campos dedicados
// (installment_second_captured_at, capture_force_full_at, etc.) y NUNCA
// tocan capture_captured_at. Como ese campo se queda permanentemente NULL
// para esas órdenes, Caso 2 se ejecutaba SIEMPRE que el webhook
// payment_intent.succeeded llegara para uno de esos PIs -- no solo en el
// caso raro de "se perdió la respuesta", sino en el camino feliz normal --
// duplicando el monto ya sumado por la escritura síncrona de la ruta
// original. Esto es un doble conteo contable real y rutinario, no un
// edge case.
//
// Se restringe Caso 2 a la allowlist real de charge_types que SÍ
// pertenecen a la familia "balance capture" tal como la escriben
// batch-capture/batch-capture-retry.
const BALANCE_CAPTURE_CHARGE_TYPES = new Set([
  "balance",
  "paypal_balance",
  "balance_retry_10pm",
  "paypal_balance_retry_10pm",
]);

export interface ReconcileResult {
  /** true si esta llamada efectivamente escribió algo en `orders`. */
  updated: boolean;
  orderId?: string;
  reason: string;
}

interface OrderCaptureRow {
  id: string;
  user_id: string | null;
  stripe_hold_payment_intent_id: string | null;
  stripe_capture_payment_intent_id: string | null;
  hold_captured_at: string | null;
  capture_captured_at: string | null;
  capture_authorized_amount: number | null;
  total_paid_cents: number | null;
  card_amount_charged_cents: number | null;
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
      "id, user_id, stripe_hold_payment_intent_id, stripe_capture_payment_intent_id, hold_captured_at, capture_captured_at, capture_authorized_amount, total_paid_cents, card_amount_charged_cents"
    )
    .eq("id", orderId)
    .limit(1);

  const order = (orders?.[0] as OrderCaptureRow | undefined) ?? undefined;
  if (!order) {
    return { updated: false, reason: `Order ${orderId} no encontrada` };
  }

  // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents/card_amount_charged_cents
  // ya están en centavos -- amountReceivedCents se suma/resta directo, sin
  // convertir a dólares (antes: amountDollars = amountReceivedCents / 100).
  const amountReceivedCents = Math.round(paymentIntent.amountReceivedCents ?? 0);

  // Caso 1: el PI que tuvo éxito ES el Hold (capturado vía .capture() en
  // alguno de los 6 call sites). El campo que marca "ya reflejado" es
  // hold_captured_at -- mismo campo que escriben esos call sites tras un
  // .capture() exitoso.
  //
  // B-P3-4/P3-5 fix (auditoría 2026-07-21): esta rama solo escribía
  // hold_captured_at -- a diferencia de la rama de balance (Caso 2), NUNCA
  // sumaba el monto capturado a total_paid_cents/card_amount_charged_cents
  // ni insertaba una entrada en shadow_ledger_entries. Un hold reconciliado
  // por esta vía (el webhook payment_intent.succeeded llegó, pero el write
  // síncrono del call site original se perdió) quedaba como ingreso real
  // invisible para los tres sistemas contables (orders, Shadow Ledger, y
  // por extensión QBO). Se cierra aplicando el mismo patrón que Caso 2 y
  // que force-full-capture/batch-capture usan para todo cobro real: sumar
  // al acumulado (nunca sobreescribir) e insertar en shadow_ledger_entries
  // con idempotencyKey determinística (event_type + externalReference),
  // que ya deduplica si esta función se invoca dos veces para el mismo PI
  // (webhook + cron de reconciliación, o reintentos de Stripe).
  if (order.stripe_hold_payment_intent_id === paymentIntent.id) {
    if (order.hold_captured_at) {
      return { updated: false, orderId: order.id, reason: "hold_captured_at ya seteado" };
    }
    const { error } = await supabase
      .from("orders")
      .update({
        hold_captured_at: new Date().toISOString(),
        total_paid_cents: (order.total_paid_cents || 0) + amountReceivedCents,
        card_amount_charged_cents: (order.card_amount_charged_cents || 0) + amountReceivedCents,
        capture_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .is("hold_captured_at", null);

    if (error) {
      return { updated: false, orderId: order.id, reason: `Update error: ${error.message}` };
    }

    if (amountReceivedCents > 0) {
      const { error: ledgerError } = await supabase.from("shadow_ledger_entries").insert(
        buildShadowLedgerEntry({
          eventType: "hold_captured",
          orderId: order.id,
          userId: order.user_id ?? null,
          amountCents: amountReceivedCents,
          processor: "stripe",
          externalReference: paymentIntent.id,
          occurredAt: new Date(),
          metadata: { reconciled: true, reason: "hold_captured_at reconciled from payment_intent.succeeded" },
        })
      );
      if (ledgerError && ledgerError.code !== "23505") {
        captureError(ledgerError, { fn: "writeHoldCapturedLedger", orderId: order.id });
      }

      // v8.6: Escribir también en financial_ledger (partida doble)
      const jeEvent: BusinessEvent = {
        event_id: crypto.randomUUID(),
        event_type: "hold_captured",
        order_id: order.id,
        user_id: order.user_id ?? null,
        amount_cents: amountReceivedCents,
        currency: "CAD",
        processor: "stripe",
        external_reference: paymentIntent.id,
        occurred_at: new Date().toISOString(),
      };
      const jeRows = generateJournalEntry(jeEvent);
      const { error: finError } = await supabase.from("financial_ledger").insert(jeRows);
      if (finError && finError.code !== "23505") {
        captureError(finError, { fn: "writeHoldCapturedFinancialLedger", orderId: order.id });
      }
    }

    return { updated: true, orderId: order.id, reason: "hold_captured_at reconciliado" };
  }

  // Caso 2: el PI que tuvo éxito es el cobro de saldo estándar (charge_type
  // "balance" / "paypal_balance" / sus reintentos 10PM -- las únicas rutas
  // que escriben capture_captured_at de forma síncrona: cron/batch-capture
  // y cron/batch-capture-retry). El campo que marca "ya reflejado" es
  // capture_captured_at -- mismo campo que escriben esas rutas tras un
  // PaymentIntent de saldo exitoso.
  //
  // Fix (auditoría externa, verificado 2026-07-31): antes CUALQUIER PI no-hold
  // con metadata.order_id caía aquí (force_full_capture, capture-remainder,
  // installment_second_payment, penalizaciones de no-show/late-cancel,
  // partial_capture_excess...) y, como esas rutas NUNCA tocan
  // capture_captured_at (tienen sus propios campos dedicados), este bloque
  // se ejecutaba SIEMPRE que su webhook payment_intent.succeeded llegara --
  // no solo en el caso de recuperación de un write perdido -- duplicando el
  // monto ya sumado por la escritura síncrona original. Ver
  // BALANCE_CAPTURE_CHARGE_TYPES arriba para el detalle completo.
  if (!paymentIntent.chargeType || !BALANCE_CAPTURE_CHARGE_TYPES.has(paymentIntent.chargeType)) {
    return {
      updated: false,
      orderId: order.id,
      reason: `PaymentIntent no es del hold ni de charge_type de saldo reconocido (charge_type=${paymentIntent.chargeType ?? "ninguno"}) -- no se reconcilia aquí, tiene su propio campo de tracking en su ruta de origen`,
    };
  }

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
      // acumular hold + saldo en total_paid_cents/card_amount_charged_cents.
      capture_authorized_amount: (order.capture_authorized_amount || 0) + amountReceivedCents,
      total_paid_cents: (order.total_paid_cents || 0) + amountReceivedCents,
      card_amount_charged_cents: (order.card_amount_charged_cents || 0) + amountReceivedCents,
      capture_attempts: 0,
      capture_last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .is("capture_captured_at", null);

  if (error) {
    return { updated: false, orderId: order.id, reason: `Update error: ${error.message}` };
  }

  // B-P3-4/P3-5 fix (auditoría 2026-07-21): esta rama tampoco insertaba en
  // shadow_ledger_entries pese a ser un cobro real reconciliado -- el mismo
  // hueco que Caso 1, cerrado aquí con el mismo patrón.
  if (amountReceivedCents > 0) {
    const { error: ledgerError } = await supabase.from("shadow_ledger_entries").insert(
      buildShadowLedgerEntry({
        eventType: "balance_captured",
        orderId: order.id,
        userId: order.user_id ?? null,
        amountCents: amountReceivedCents,
        processor: "stripe",
        externalReference: paymentIntent.id,
        occurredAt: new Date(),
        metadata: { reconciled: true, reason: "capture_captured_at reconciled from payment_intent.succeeded" },
      })
    );
    if (ledgerError && ledgerError.code !== "23505") {
      captureError(ledgerError, { fn: "writeBalanceCapturedLedger", orderId: order.id });
    }

    // v8.6: Escribir también en financial_ledger (partida doble)
    const jeEvent: BusinessEvent = {
      event_id: crypto.randomUUID(),
      event_type: "balance_captured",
      order_id: order.id,
      user_id: order.user_id ?? null,
      amount_cents: amountReceivedCents,
      currency: "CAD",
      processor: "stripe",
      external_reference: paymentIntent.id,
      occurred_at: new Date().toISOString(),
    };
    const jeRows = generateJournalEntry(jeEvent);
    const { error: finError } = await supabase.from("financial_ledger").insert(jeRows);
    if (finError && finError.code !== "23505") {
      captureError(finError, { fn: "writeBalanceCapturedFinancialLedger", orderId: order.id });
    }
  }

  return { updated: true, orderId: order.id, reason: "capture_captured_at reconciliado" };
}

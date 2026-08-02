import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import Stripe from "stripe";
import { reconcileCapturedPaymentIntent } from "@/lib/payment-capture-reconciliation";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { safeErrorResponse } from "@/lib/api-errors";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = SupabaseClient<any, "public", any>;

/**
 * POST /api/stripe/webhook
 *
 * Recibe eventos de Stripe y sincroniza el estado de pagos en Supabase.
 * Requiere configurar STRIPE_WEBHOOK_SECRET en el dashboard de Stripe
 * y en las variables de entorno.
 */

export async function POST(request: NextRequest) {
  const stripe = assertStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 400, "Invalid webhook signature");
  }

  try {
    // Idempotencia: no procesar el mismo event.id dos veces
    const { data: existingEvent } = await supabase
      .from("stripe_webhook_events")
      .select("id")
      .eq("stripe_event_id", event.id)
      .limit(1);

    if (existingEvent && existingEvent.length > 0) {
      return NextResponse.json({ received: true, duplicated: true }, { status: 200 });
    }

    // B-P2-4 fix (auditoría 2026-07-21): antes el error del INSERT de
    // deduplicación se descartaba silenciosamente y el switch se ejecutaba
    // igual. stripe_webhook_events.stripe_event_id es UNIQUE (036), así que
    // dos entregas concurrentes del mismo evento (Stripe reintenta si no
    // recibe 200 a tiempo) podían pasar ambas el SELECT de arriba antes de
    // que cualquiera insertara, y las dos procesaban el evento -- doble
    // efecto (doble captura reconciliada, doble ajuste de chargeback
    // reserve, doble resta de reembolso). Ahora el 23505 se trata como
    // "ya se está procesando en paralelo" y se corta aquí; cualquier otro
    // error de inserción se propaga como fallo real en vez de continuar
    // a ciegas.
    const { error: dedupInsertError } = await supabase.from("stripe_webhook_events").insert({
      stripe_event_id: event.id,
      event_type: event.type,
    });

    if (dedupInsertError) {
      if (dedupInsertError.code === "23505") {
        return NextResponse.json({ received: true, duplicated: true }, { status: 200 });
      }
      throw dedupInsertError;
    }

    switch (event.type) {
      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentFailure(supabase, paymentIntent);
        break;
      }
      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentIntentCancellation(supabase, paymentIntent);
        break;
      }
      case "payment_intent.succeeded": {
        // v8.3 M-2 (auditoría implacable 2026-07-20b): red de seguridad para
        // cuando una de las 6 rutas que capturan pagos directamente pierde
        // la respuesta HTTP de Stripe después de que la captura tuvo éxito
        // (timeout de red, proceso matado a mitad, etc.) -- este evento SÍ
        // llega siempre que Stripe confirme el cobro, independientemente de
        // si nuestro proceso vivió para procesar la respuesta síncrona.
        // Idempotente: reconcileCapturedPaymentIntent solo escribe si el
        // campo correspondiente (hold_captured_at / capture_captured_at)
        // sigue en null; además esta ruta ya deduplicó por stripe_event_id
        // arriba.
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const result = await reconcileCapturedPaymentIntent(supabase, {
          id: paymentIntent.id,
          amountReceivedCents: paymentIntent.amount_received ?? paymentIntent.amount ?? 0,
          orderId: paymentIntent.metadata?.order_id,
          chargeType: paymentIntent.metadata?.charge_type,
        });
        if (result.updated) {
          console.log(`[stripe/webhook] Reconciled capture for order ${result.orderId}: ${result.reason}`);
        }
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        await handleDisputeCreated(supabase, dispute);
        break;
      }
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        await handleDisputeClosed(supabase, dispute);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        await handleRefund(supabase, charge);
        break;
      }
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

async function handlePaymentIntentFailure(
  supabase: SupabaseAdmin,
  paymentIntent: Stripe.PaymentIntent
) {
  const orderId = paymentIntent.metadata?.order_id;
  if (!orderId) return;

  // Si es el hold, registrar el error y reintentos futuros se encargarán.
  await supabase
    .from("orders")
    .update({
      hold_last_error: paymentIntent.last_payment_error?.message?.slice(0, 500) || "Payment failed",
      hold_attempts: 3, // Evita reintentos automáticos; requiere revisión manual
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("stripe_hold_payment_intent_id", paymentIntent.id);
}

async function handlePaymentIntentCancellation(
  supabase: SupabaseAdmin,
  paymentIntent: Stripe.PaymentIntent
) {
  const orderId = paymentIntent.metadata?.order_id;
  if (!orderId) return;

  await supabase
    .from("orders")
    .update({
      hold_released_at: new Date().toISOString(),
      hold_last_error: "Canceled via Stripe",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("stripe_hold_payment_intent_id", paymentIntent.id);
}

async function handleDisputeCreated(
  supabase: SupabaseAdmin,
  dispute: Stripe.Dispute
) {
  const paymentIntentId = dispute.payment_intent as string | undefined;
  if (!paymentIntentId) return;

  const { data: orders } = await supabase
    .from("orders")
    .select("id, user_id")
    .or(`stripe_hold_payment_intent_id.eq.${paymentIntentId},stripe_capture_payment_intent_id.eq.${paymentIntentId}`)
    .limit(1);

  const order = orders?.[0];
  if (!order) return;

  await supabase
    .from("orders")
    .update({
      warranty_status: "escalated",
      warranty_resolution_notes: `Stripe dispute ${dispute.id} - amount ${dispute.amount} cents`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  // El spec v8.2 penaliza -25 por disputa PERDIDA. Stripe no siempre envía closed en el mismo evento,
  // así que esperamos el evento closed para contar solo las perdidas.
}

async function handleDisputeClosed(
  supabase: SupabaseAdmin,
  dispute: Stripe.Dispute
) {
  const paymentIntentId = dispute.payment_intent as string | undefined;
  if (!paymentIntentId) return;

  // v8.3 AUDITORÍA RESERVA→DINERO→RESEÑA: hallazgo real. chargeback_reserves
  // (migración 024, reserva de 1-3% del cobro) nunca se tocaba desde este
  // webhook -- ni cuando el chargeback se PIERDE (debería aplicarse, no
  // quedar "held" para siempre) ni cuando se GANA (debería liberarse de
  // inmediato en vez de esperar los 180 días default). Se resuelve aquí,
  // independientemente del resto de la función que solo corre para 'lost'.
  const { data: reserveRows } = await supabase
    .from("chargeback_reserves")
    .select("id, reserve_amount, status")
    .eq("payment_intent_id", paymentIntentId)
    .in("status", ["held", "partially_released"]);

  for (const reserve of reserveRows || []) {
    if (dispute.status === "lost") {
      // La reserva existe exactamente para esto: cubrir la pérdida. Se
      // marca 'applied' (consumida), no 'released' (que implica que vuelve
      // a caja disponible).
      await supabase
        .from("chargeback_reserves")
        .update({
          status: "applied",
          released_amount: reserve.reserve_amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reserve.id);
    } else if (dispute.status === "won") {
      // Disputa ganada: el riesgo que motivó la reserva ya no existe, se
      // libera de inmediato en vez de esperar release_date (180 días).
      await supabase
        .from("chargeback_reserves")
        .update({
          status: "released",
          released_amount: reserve.reserve_amount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reserve.id);
    }
  }

  if (dispute.status !== "lost") return;

  const { data: orders } = await supabase
    .from("orders")
    .select("id, user_id")
    .or(`stripe_hold_payment_intent_id.eq.${paymentIntentId},stripe_capture_payment_intent_id.eq.${paymentIntentId}`)
    .limit(1);

  const order = orders?.[0];
  if (!order?.user_id) return;

  await supabase.rpc("increment_disputes_lost_count", { p_user_id: order.user_id });

  // Recalcular score del cliente
  const { data: profile } = await supabase
    .from("client_profiles")
    .select("services_count, disputes_lost_count, no_show_count")
    .eq("user_id", order.user_id)
    .single();

  if (profile) {
    const newScore = Math.max(-100, Math.min(100,
      50 +
      (profile.services_count || 0) * 20 +
      (profile.disputes_lost_count || 0) * -25 +
      (profile.no_show_count || 0) * -25
    ));
    await supabase
      .from("client_profiles")
      .update({ score: newScore, updated_at: new Date().toISOString() })
      .eq("user_id", order.user_id);
  }

  await supabase
    .from("orders")
    .update({
      warranty_status: "resolved_client",
      warranty_resolution_notes: `Stripe dispute ${dispute.id} closed as lost`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
}

async function handleRefund(
  supabase: SupabaseAdmin,
  charge: Stripe.Charge
) {
  const paymentIntentId = charge.payment_intent as string | undefined;
  if (!paymentIntentId) return;

  // B-P2-1 fix (auditoría 2026-07-21): charge.amount_refunded que manda
  // Stripe en `charge.refunded` es el ACUMULADO de todo lo reembolsado en
  // ese charge hasta el momento del evento, no el delta de este reembolso.
  // El código anterior lo restaba como si fuera un delta en cada evento:
  // dos reembolsos parciales de $100 y luego $50 (cumulative 100, luego
  // cumulative 150) dejaban total_paid descontado dos veces (-100 y -150
  // sobre el saldo ya reducido), sobre-restando muy por debajo de lo
  // realmente reembolsado. Se guarda el acumulado ya conocido en
  // `stripe_amount_refunded_cents` (migración 208) y se resta solo el
  // delta real entre el acumulado nuevo y el anterior.
  //
  // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents/card_amount_charged_cents
  // ya están en centavos -- se resta deltaCents directo, sin la conversión
  // a dólares que existía antes (refundedAmount = deltaCents / 100).
  const { data: orders } = await supabase
    .from("orders")
    .select("id, user_id, total_paid_cents, card_amount_charged_cents, stripe_amount_refunded_cents")
    .or(`stripe_hold_payment_intent_id.eq.${paymentIntentId},stripe_capture_payment_intent_id.eq.${paymentIntentId}`)
    .limit(1);

  const order = orders?.[0];
  if (!order) return;

  const previousRefundedCents = order.stripe_amount_refunded_cents ?? 0;
  const newCumulativeRefundedCents = charge.amount_refunded ?? 0;
  const deltaCents = newCumulativeRefundedCents - previousRefundedCents;

  if (deltaCents <= 0) {
    // Evento repetido/fuera de orden respecto al acumulado ya registrado;
    // nada nuevo que restar (evita restar dos veces el mismo reembolso si
    // Stripe reenvía el evento con el mismo acumulado).
    return;
  }

  const newTotalPaidCents = Math.max(0, (order.total_paid_cents ?? 0) - deltaCents);

  // Fix (auditoría implacable 2026-08-01, bug real confirmado): antes esta
  // línea era `card_amount_charged_cents: newTotalPaidCents` -- igualaba la
  // porción de TARJETA al total pagado. Son columnas con semántica distinta
  // y el resto del repo las trata como tales: `total_paid_cents` incluye
  // billetera y adelanto de PayPal, mientras que `card_amount_charged_cents`
  // es SOLO lo cobrado a la tarjeta (ver /api/orders/[orderId]/cancel líneas
  // ~290-297, que para una orden de billetera pone card=0 con total_paid>0, y
  // batch-capture ~418-419, que suma walletAppliedCents solo al total).
  //
  // Efecto real del bug en una orden de pago mixto: $100 pagados = $30 de
  // billetera + $70 de tarjeta (total_paid=10000, card=7000). Llega un
  // reembolso de $20 -> newTotalPaidCents=8000 -> card quedaba en 8000, o sea
  // la cifra de tarjeta SUBÍA de 7000 a 8000 a causa de un REEMBOLSO. Eso
  // corrompe el export contable a QuickBooks (qbo-sync lee justamente
  // card_amount_charged_cents, ver su select) y cualquier conciliación
  // tarjeta-vs-billetera contra el depósito real del procesador.
  //
  // Correcto: un reembolso de Stripe devuelve dinero de la TARJETA, así que
  // se resta el mismo delta a la porción de tarjeta, con piso en 0.
  const newCardChargedCents = Math.max(0, (order.card_amount_charged_cents ?? 0) - deltaCents);

  await supabase
    .from("orders")
    .update({
      total_paid_cents: newTotalPaidCents,
      card_amount_charged_cents: newCardChargedCents,
      stripe_amount_refunded_cents: newCumulativeRefundedCents,
      warranty_status: newTotalPaidCents === 0 ? "resolved_client" : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  // B-P2-2 fix (auditoría 2026-07-21): shadow_ledger_entries tiene el tipo
  // 'warranty_refund' declarado (shadow-ledger.ts) pero ninguna ruta del
  // repo lo insertaba jamás -- ningún reembolso (chargeback ganado por el
  // cliente, resolución de garantía, reembolso manual del admin vía
  // Stripe) quedaba registrado en el ledger operativo, así que las
  // comisiones de partner y créditos de referido ya pagados sobre esa
  // orden nunca se marcaban para revisión/reclamo. Se registra aquí el
  // delta real reembolsado, con idempotencyKey determinística por charge
  // para no duplicar si Stripe reenvía el evento.
  const { error: ledgerError } = await supabase.from("shadow_ledger_entries").insert(
    buildShadowLedgerEntry({
      eventType: "warranty_refund",
      orderId: order.id,
      userId: order.user_id ?? null,
      amountCents: deltaCents,
      processor: "stripe",
      externalReference: `${charge.id}:${newCumulativeRefundedCents}`,
      occurredAt: new Date(),
      metadata: { payment_intent_id: paymentIntentId, charge_id: charge.id },
    })
  );
  if (ledgerError && ledgerError.code !== "23505") {
    console.error(`Failed to write shadow ledger warranty_refund entry for order ${order.id}:`, ledgerError);
  }
}

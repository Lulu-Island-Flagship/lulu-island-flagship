import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import Stripe from "stripe";

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
    const message = err instanceof Error ? err.message : "Unknown webhook error";
    console.error("Stripe webhook signature verification failed:", message);
    return NextResponse.json({ error: message }, { status: 400 });
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

    await supabase.from("stripe_webhook_events").insert({
      stripe_event_id: event.id,
      event_type: event.type,
    });

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
    const message = err instanceof Error ? err.message : "Unknown webhook handler error";
    console.error("Stripe webhook handler error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
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

  const { data: orders } = await supabase
    .from("orders")
    .select("id, total_paid")
    .or(`stripe_hold_payment_intent_id.eq.${paymentIntentId},stripe_capture_payment_intent_id.eq.${paymentIntentId}`)
    .limit(1);

  const order = orders?.[0];
  if (!order) return;

  const refundedAmount = charge.amount_refunded / 100; // cents -> dollars
  const newTotalPaid = Math.max(0, (order.total_paid ?? 0) - refundedAmount);

  await supabase
    .from("orders")
    .update({
      total_paid: newTotalPaid,
      card_amount_charged: newTotalPaid,
      warranty_status: newTotalPaid === 0 ? "resolved_client" : undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);
}

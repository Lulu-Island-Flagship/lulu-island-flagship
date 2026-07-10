import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import { computeCancellationDecision } from "@/lib/order-cancellation";

/**
 * POST /api/orders/[orderId]/cancel
 *
 * Permite a un cliente cancelar su orden. El spec v8.2/D.3 establece:
 *  - >72h antes del servicio: hold liberado, sin cargo.
 *  - 24-72h antes: se captura el 50% del hold como penalidad.
 *  - <24h / no-show: se captura el 100% del hold como penalidad.
 *
 * Para PayPal primer servicio:
 *  - >72h: reembolso completo del anticipo PayPal (proceso manual/async).
 *  - 24-72h: anticipo retenido (equivale a la penalidad del 50% del hold).
 *  - <24h: anticipo retenido + diferencia hasta el hold completo cobrada por Stripe.
 *
 * La decisión de CUÁNTO cobrar/liberar es una función pura testeable
 * (src/lib/order-cancellation.ts, tests en tests/lib/order-cancellation.test.ts).
 * Este archivo solo ejecuta esa decisión contra Stripe y persiste el resultado.
 */

function hoursUntilService(serviceDatetime: string): number {
  // service_datetime se almacena como ISO UTC; comparar timestamps UTC es determinista
  // y equivalente a calcular en hora Vancouver para ventanas de horas.
  const serviceDate = new Date(serviceDatetime);
  const now = new Date();
  return (serviceDate.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params;
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
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
    const stripe = assertStripe();

    // Autenticar usando el header Authorization para soportar tanto sesión como llamadas service-to-service
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      if (token === process.env.CRON_SECRET) {
        // Llamada service-to-service; no requiere user autenticado
        userId = null;
      } else {
        const { data } = await supabase.auth.getUser(token);
        userId = data.user?.id ?? null;
      }
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, user_id, status, service_datetime, payment_option, stripe_hold_payment_intent_id, hold_authorized_amount, hold_amount, paypal_advance_amount, paypal_transaction_id, stripe_customer_id, stripe_payment_method_id, quotes(total)"
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Si no es llamada service-to-service, verificar propiedad
    if (userId && order.user_id !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (["cancelled", "completed", "no_show"].includes(order.status)) {
      return NextResponse.json(
        { error: "Order cannot be cancelled" },
        { status: 409 }
      );
    }

    const quoteTotal = Math.round(Number((order.quotes as unknown as { total: number }[] | null)?.[0]?.total ?? 0));
    const hoursLeft = hoursUntilService(order.service_datetime);

    const decision = computeCancellationDecision({
      hoursUntilService: hoursLeft,
      quoteTotal,
      holdAuthorizedAmount: order.hold_authorized_amount || 0,
      holdAmount: order.hold_amount || 0,
      paymentOption: order.payment_option,
      paypalAdvanceAmount: order.paypal_advance_amount || 0,
    });

    let penaltyCharged = decision.paypalAmountRetained;
    let holdCancelled = false;
    const paypalRefundRequired = decision.paypalRefundRequired;
    const payments: { hold?: string; penalty?: string } = {};

    // 1. Liberar/cancelar el Hold en Stripe si corresponde (best-effort: un
    // fallo aquí no bloquea la cancelación, solo queda logueado — igual que
    // el comportamiento original).
    if (decision.releaseStripeHold && order.stripe_hold_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(order.stripe_hold_payment_intent_id);
        }
        holdCancelled = true;
      } catch (err) {
        console.error(`Failed to cancel hold for order ${orderId}:`, err);
      }
    }

    // 2. Capturar penalidad desde el Hold ya autorizado (tarjeta, 24-72h o <24h).
    if (decision.captureFromExistingHold > 0 && order.stripe_hold_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.capture(order.stripe_hold_payment_intent_id, {
            amount_to_capture: decision.captureFromExistingHold * 100,
          });
          payments.hold = order.stripe_hold_payment_intent_id;
          penaltyCharged += decision.captureFromExistingHold;
        } else if (pi.status === "succeeded") {
          // Ya estaba capturado por otro flujo (p.ej. batch capture corrió antes);
          // el cargo real es el hold completo, no solo la penalidad prevista.
          penaltyCharged += order.hold_authorized_amount || order.hold_amount || 0;
        }
      } catch (err) {
        console.error(`Failed to capture hold penalty for order ${orderId}:`, err);
        return NextResponse.json(
          { error: "Failed to process cancellation penalty. Please contact support." },
          { status: 502 }
        );
      }
    }

    // 3. PayPal <24h: cobrar por Stripe la diferencia entre el anticipo
    // retenido y la penalidad completa (tarjeta obligatoria en la reserva).
    if (decision.stripeAdditionalChargeAmount > 0) {
      try {
        if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
          throw new Error("Missing card registration for PayPal late cancellation");
        }
        const penaltyPi = await stripe.paymentIntents.create({
          amount: decision.stripeAdditionalChargeAmount * 100,
          currency: "cad",
          customer: order.stripe_customer_id,
          payment_method: order.stripe_payment_method_id,
          payment_method_types: ["card"],
          capture_method: "automatic",
          confirm: true,
          off_session: true,
          description: `Late cancellation penalty for PayPal order ${orderId}`,
          metadata: { order_id: orderId, charge_type: "paypal_late_cancel_penalty" },
        });
        if (penaltyPi.status !== "succeeded") {
          throw new Error(`Penalty PaymentIntent status: ${penaltyPi.status}`);
        }
        payments.penalty = penaltyPi.id;
        penaltyCharged += decision.stripeAdditionalChargeAmount;
      } catch (err) {
        console.error(`Failed to charge PayPal late cancellation penalty for order ${orderId}:`, err);
        return NextResponse.json(
          { error: "Failed to process late cancellation penalty. Please contact support." },
          { status: 502 }
        );
      }
    }

    await supabase
      .from("orders")
      .update({
        status: "cancelled",
        hold_released_at: holdCancelled ? new Date().toISOString() : null,
        hold_captured_at: payments.hold ? new Date().toISOString() : null,
        total_paid: penaltyCharged,
        card_amount_charged:
          order.payment_option === "paypal_first_time"
            ? Math.max(0, penaltyCharged - (order.paypal_advance_amount || 0))
            : penaltyCharged,
        paypal_refund_required: paypalRefundRequired,
        paypal_refund_status: paypalRefundRequired ? "pending" : "not_required",
        capture_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    // Liberar slot de capacidad comprometido
    const { data: slot } = await supabase
      .from("capacity_slots")
      .select("id, committed_teams")
      .eq("service_date", order.service_datetime.split("T")[0])
      .eq("start_time", order.service_datetime.split("T")[1]?.slice(0, 5))
      .limit(1)
      .single();

    if (slot && slot.committed_teams > 0) {
      await supabase
        .from("capacity_slots")
        .update({ committed_teams: slot.committed_teams - 1, updated_at: new Date().toISOString() })
        .eq("id", slot.id);
    }

    return NextResponse.json(
      {
        orderId,
        status: "cancelled",
        hoursUntilService: Math.max(0, Math.round(hoursLeft * 10) / 10),
        window: decision.window,
        penaltyCharged,
        holdCancelled,
        paypalRefundRequired,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Cancel order error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

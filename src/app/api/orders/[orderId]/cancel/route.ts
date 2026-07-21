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
    // Fix RAÍZ-2 (auditoría 2026-07-21): el bloque original era un `if` sin
    // `else` — sin header, o con un Bearer inválido, `userId` quedaba `null`
    // y el chequeo de propiedad de más abajo se saltaba por completo,
    // permitiendo cancelar (y capturar el hold de) la orden de un cliente
    // ajeno sin ninguna credencial. Ahora se exige explícitamente CRON_SECRET
    // o un JWT de Supabase válido; cualquier otro caso es 401.
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;

    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.replace("Bearer ", "");
    if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
      // Llamada service-to-service; no requiere user autenticado
      userId = null;
    } else {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (authError || !data.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      userId = data.user.id;
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, user_id, status, service_datetime, payment_option, stripe_hold_payment_intent_id, hold_authorized_amount_cents, hold_amount_cents, paypal_advance_amount, paypal_transaction_id, stripe_customer_id, stripe_payment_method_id, wallet_amount_used_cents, quotes(total, zone)"
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

    const quoteRow = (order.quotes as unknown as { total: number; zone: string | null }[] | null)?.[0];
    // RAÍZ-3 (2026-07-21, migración 229): quotes.total sigue en dólares
    // (fuera de alcance) -- se escala x100 para operar en centavos junto a
    // hold_amount_cents/hold_authorized_amount_cents. computeCancellationDecision
    // es agnóstica a la unidad (solo hace min/max/round), así que basta con
    // pasarle todo en la misma unidad -- centavos, de aquí en adelante.
    const quoteTotalCents = Math.round(Number(quoteRow?.total ?? 0) * 100);
    const orderZone = quoteRow?.zone ?? null;
    const hoursLeft = hoursUntilService(order.service_datetime);

    const decision = computeCancellationDecision({
      hoursUntilService: hoursLeft,
      quoteTotal: quoteTotalCents,
      holdAuthorizedAmount: order.hold_authorized_amount_cents || 0,
      holdAmount: order.hold_amount_cents || 0,
      paymentOption: order.payment_option,
      paypalAdvanceAmount: Math.round((order.paypal_advance_amount || 0) * 100),
    });

    // RAÍZ-3 (2026-07-21, migración 229): penaltyCharged ahora se acumula en
    // CENTAVOS (todos los inputs de computeCancellationDecision ya se pasan
    // en centavos arriba).
    let penaltyChargedCents = decision.paypalAmountRetained;
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
          await stripe.paymentIntents.capture(
            order.stripe_hold_payment_intent_id,
            { amount_to_capture: decision.captureFromExistingHold },
            { idempotencyKey: `${orderId}:cancel-hold-capture` }
          );
          payments.hold = order.stripe_hold_payment_intent_id;
          penaltyChargedCents += decision.captureFromExistingHold;
        } else if (pi.status === "succeeded") {
          // Ya estaba capturado por otro flujo (p.ej. batch capture corrió antes);
          // el cargo real es el hold completo, no solo la penalidad prevista.
          penaltyChargedCents += order.hold_authorized_amount_cents || order.hold_amount_cents || 0;
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
        const penaltyPi = await stripe.paymentIntents.create(
          {
            amount: decision.stripeAdditionalChargeAmount,
            currency: "cad",
            customer: order.stripe_customer_id,
            payment_method: order.stripe_payment_method_id,
            payment_method_types: ["card"],
            capture_method: "automatic",
            confirm: true,
            off_session: true,
            description: `Late cancellation penalty for PayPal order ${orderId}`,
            metadata: { order_id: orderId, charge_type: "paypal_late_cancel_penalty" },
          },
          { idempotencyKey: `${orderId}:cancel-paypal-penalty` }
        );
        if (penaltyPi.status !== "succeeded") {
          throw new Error(`Penalty PaymentIntent status: ${penaltyPi.status}`);
        }
        payments.penalty = penaltyPi.id;
        penaltyChargedCents += decision.stripeAdditionalChargeAmount;
      } catch (err) {
        console.error(`Failed to charge PayPal late cancellation penalty for order ${orderId}:`, err);
        return NextResponse.json(
          { error: "Failed to process late cancellation penalty. Please contact support." },
          { status: 502 }
        );
      }
    }

    // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents/
    // card_amount_charged_cents ya están en centavos -- paypal_advance_amount
    // sigue en dólares (fuera de alcance), se escala x100 al restarlo.
    await supabase
      .from("orders")
      .update({
        status: "cancelled",
        hold_released_at: holdCancelled ? new Date().toISOString() : null,
        hold_captured_at: payments.hold ? new Date().toISOString() : null,
        total_paid_cents: penaltyChargedCents,
        card_amount_charged_cents:
          order.payment_option === "paypal_first_time"
            ? Math.max(0, penaltyChargedCents - Math.round((order.paypal_advance_amount || 0) * 100))
            : penaltyChargedCents,
        paypal_refund_required: paypalRefundRequired,
        paypal_refund_status: paypalRefundRequired ? "pending" : "not_required",
        capture_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    // v8.3 fix (auditoría 2026-07-15): cancelar la orden nunca marcaba las
    // asignaciones (assignments) como canceladas. El listado de servicios
    // del empleado (/api/empleado/servicios) filtra por orders.status y
    // assignments.status != 'cancelled', pero como esa columna nunca
    // llegaba a 'cancelled', un empleado podía seguir viendo y desplazarse
    // a un servicio que el cliente ya canceló, sin ninguna señal en su app.
    await supabase
      .from("assignments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("order_id", orderId)
      .is("deleted_at", null)
      .not("status", "in", "(completed,cancelled)");

    // v8.3 fix (auditoría 2026-07-15): si el cliente había aplicado crédito
    // de Lulu Wallet a esta orden (orders.wallet_amount_used_cents -- RAÍZ-3,
    // migración 229: CENTAVOS -- ver /api/client/wallet/apply), ese crédito
    // se perdía para siempre al cancelar: nunca se revertía el débito ni se
    // restauraba el saldo de client_wallets. Se revierte SIEMPRE,
    // independiente de la penalidad de cancelación (son conceptos distintos:
    // la penalidad es lo que se cobra por cancelar tarde; el wallet es
    // dinero propio del cliente que ya no necesita cubrir un servicio que no
    // va a ocurrir).
    const walletAmountUsedCents = Math.max(0, order.wallet_amount_used_cents || 0);
    if (walletAmountUsedCents > 0) {
      try {
        const { data: wallet } = await supabase
          .from("client_wallets")
          .select("id")
          .eq("user_id", order.user_id)
          .maybeSingle();

        if (wallet) {
          const refundCents = walletAmountUsedCents;
          // v8.3 fix (auditoría 2026-07-15): mutación atómica vía RPC
          // (migración 180) en vez de read-then-write sin bloqueo.
          const { error: rpcError } = await supabase.rpc("apply_wallet_delta", {
            p_wallet_id: wallet.id,
            p_user_id: order.user_id,
            p_order_id: orderId,
            p_type: "credit",
            p_delta: refundCents,
            p_description: `Reembolso por cancelación de orden ${orderId}`,
          });
          if (rpcError) {
            console.error(`Failed to reverse wallet credit for order ${orderId}:`, rpcError);
          }
        } else {
          console.error(`Cannot reverse wallet credit for order ${orderId}: no wallet found for user ${order.user_id}`);
        }
      } catch (err) {
        // Best-effort: un fallo al revertir el wallet no debe bloquear la
        // cancelación en sí (el cliente ya pidió cancelar); queda logueado
        // para revisión manual en vez de perder silenciosamente el dinero.
        console.error(`Wallet reversal error for order ${orderId}:`, err);
      }
    }

    // Liberar slot de capacidad comprometido.
    // v8.3 fix (auditoría 2026-07-15): antes esta consulta buscaba el slot
    // SOLO por fecha/hora, sin filtrar por zona. /api/stripe/confirm (donde
    // se COMPROMETE el cupo al reservar) prioriza el slot específico de
    // zona sobre uno flexible (zone IS NULL) cuando ambos existen para el
    // mismo horario. Al cancelar, con `.limit(1).single()` sin ORDER BY ni
    // filtro de zona, se podía tomar y decrementar el slot EQUIVOCADO
    // (el flexible en vez del de zona, o viceversa), desalineando el
    // contador real de cupos con el tiempo. Se replica aquí la misma
    // prioridad de búsqueda (zona específica primero) y se agrega un
    // bloqueo optimista (.eq("committed_teams", ...)) para no pisar una
    // escritura concurrente.
    const { data: slot } = await supabase
      .from("capacity_slots")
      .select("id, committed_teams")
      .eq("service_date", order.service_datetime.split("T")[0])
      .eq("start_time", order.service_datetime.split("T")[1]?.slice(0, 5))
      .or(orderZone ? `zone.eq."${orderZone}",zone.is.null` : "zone.is.null")
      .order("zone", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (slot && slot.committed_teams > 0) {
      const { error: releaseError } = await supabase
        .from("capacity_slots")
        .update({ committed_teams: slot.committed_teams - 1, updated_at: new Date().toISOString() })
        .eq("id", slot.id)
        .eq("committed_teams", slot.committed_teams);
      if (releaseError) {
        console.error(`Failed to release capacity slot ${slot.id} for cancelled order ${orderId}:`, releaseError);
      }
    }

    return NextResponse.json(
      {
        orderId,
        status: "cancelled",
        hoursUntilService: Math.max(0, Math.round(hoursLeft * 10) / 10),
        window: decision.window,
        penaltyChargedCents,
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

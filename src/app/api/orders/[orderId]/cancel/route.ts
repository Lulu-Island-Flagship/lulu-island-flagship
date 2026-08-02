import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import { computeCancellationDecision } from "@/lib/order-cancellation";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { safeErrorResponse } from "@/lib/api-errors";

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
        "id, user_id, status, service_datetime, payment_option, stripe_hold_payment_intent_id, hold_authorized_amount_cents, hold_amount_cents, paypal_advance_amount, paypal_transaction_id, stripe_customer_id, stripe_payment_method_id, wallet_amount_used_cents, wallet_payment_intent_id, wallet_amount_collected_cents, quotes(total, zone)"
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

    // Fix Kimi-C5 (auditoría externa Kimi Code, 2026-07-21, verificado por
    // Claude antes de aplicar -- el reporte citaba "doble cobro" vía Stripe,
    // pero los cargos de Stripe ya estaban protegidos por idempotencyKey más
    // abajo; el riesgo real verificado es el REEMBOLSO de wallet vía
    // apply_wallet_delta, que no tenía ninguna protección contra ejecutarse
    // dos veces). El chequeo de arriba (["cancelled","completed","no_show"])
    // es lectura-luego-escritura (TOCTOU): si dos peticiones de cancelación
    // casi simultáneas para la misma orden pasan ambas ese chequeo antes de
    // que cualquiera termine, ambas seguirían de largo y ambas revertirían
    // el crédito de wallet usado (más abajo), duplicando el reembolso.
    //
    // Fix: transición de estado atómica (CAS) AQUÍ, ANTES de tocar Stripe o
    // wallet -- solo la petición que efectivamente logra transicionar
    // order.status (0 filas afectadas para el perdedor) continúa con los
    // efectos secundarios de dinero. `.eq("status", order.status)` usa el
    // valor de status ya leído arriba, así que cualquier otra petición
    // concurrente que ya haya ganado la carrera hace que esta pierda aquí,
    // sin haber tocado Stripe ni wallet todavía.
    const { data: claimedRows } = await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", order.status)
      .select("id");

    if (!claimedRows || claimedRows.length === 0) {
      return NextResponse.json(
        { error: "Order cancellation already in progress or already completed by another request" },
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
      walletAmountCollected: order.wallet_amount_collected_cents || 0,
    });

    const isWalletOrder = order.payment_option === "alipay" || order.payment_option === "wechat_pay";
    let walletRefundedCents = 0;

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

    // 4. Alipay/WeChat Pay: el 100% ya fue cobrado por adelantado vía un
    // PaymentIntent real de Stripe (no vía card off_session) -- cancelar
    // nunca implica un cargo nuevo, solo reembolsar (a través de la misma
    // API de Stripe, síncrono) la porción que no corresponde retener como
    // penalidad (decision.walletRefundAmount, calculado por la función pura
    // de arriba: 100% en >72h, mitad del hold en 24-72h, 0 en <24h/no-show).
    if (decision.walletRefundAmount > 0 && order.wallet_payment_intent_id) {
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: order.wallet_payment_intent_id,
            amount: decision.walletRefundAmount,
            metadata: { order_id: orderId, charge_type: "wallet_cancellation_refund" },
          },
          { idempotencyKey: `${orderId}:cancel-wallet-refund` }
        );
        walletRefundedCents = refund.amount;
      } catch (err) {
        console.error(`Failed to refund Alipay/WeChat Pay payment for order ${orderId}:`, err);
        return NextResponse.json(
          { error: "Failed to process refund. Please contact support." },
          { status: 502 }
        );
      }
    }

    // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents/
    // card_amount_charged_cents ya están en centavos -- paypal_advance_amount
    // sigue en dólares (fuera de alcance), se escala x100 al restarlo.
    //
    // Fix Kimi-C5: status ya se transicionó a 'cancelled' arriba (CAS,
    // ganador de la carrera) -- este UPDATE ya no necesita (ni debe) volver
    // a tocar status, solo persiste los montos/timestamps calculados tras
    // los cargos de Stripe.
    //
    // Alipay/WeChat Pay: total_paid_cents es lo YA cobrado por adelantado
    // menos lo reembolsado (no penaltyChargedCents, que para estas órdenes
    // se queda en 0 -- no hubo cargo NUEVO, solo retención de dinero ya
    // cobrado). card_amount_charged_cents es 0 porque nunca se tocó la
    // tarjeta de respaldo en esta cancelación.
    await supabase
      .from("orders")
      .update({
        hold_released_at: holdCancelled ? new Date().toISOString() : null,
        hold_captured_at: payments.hold ? new Date().toISOString() : null,
        total_paid_cents: isWalletOrder
          ? Math.max(0, (order.wallet_amount_collected_cents || 0) - walletRefundedCents)
          : penaltyChargedCents,
        card_amount_charged_cents: isWalletOrder
          ? 0
          : order.payment_option === "paypal_first_time"
            ? Math.max(0, penaltyChargedCents - Math.round((order.paypal_advance_amount || 0) * 100))
            : penaltyChargedCents,
        wallet_refunded_amount_cents: walletRefundedCents,
        paypal_refund_required: paypalRefundRequired,
        paypal_refund_status: paypalRefundRequired ? "pending" : "not_required",
        capture_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (walletRefundedCents > 0) {
      try {
        await supabase.from("shadow_ledger_entries").insert(
          buildShadowLedgerEntry({
            eventType: "wallet_refund",
            orderId,
            userId: order.user_id,
            amountCents: walletRefundedCents,
            processor: "stripe",
            externalReference: order.wallet_payment_intent_id,
            occurredAt: new Date(),
            metadata: { source: "orders_cancel_route", hoursUntilService: hoursLeft, paymentOption: order.payment_option },
          })
        );
      } catch (shadowLedgerErr) {
        console.error(`Shadow ledger insert failed for wallet refund on order ${orderId}:`, shadowLedgerErr);
      }
    }

    // Fix F3 (auditoría operativa/contable 2026-07-21, verificado y
    // confirmado real): esta ruta cobra dinero real (captura de hold vía
    // Stripe, o el cargo adicional de PayPal <24h) y actualiza
    // total_paid_cents/card_amount_charged_cents, pero NUNCA insertaba en
    // shadow_ledger_entries -- el tipo 'cancellation_penalty' ya existe en
    // shadow-ledger.ts (documentado como evento que DEBE loguearse) pero
    // nadie lo usaba. Sin esto, la penalidad de cancelación cobrada es
    // invisible para la reconciliación interna. Se registra solo si
    // realmente se cobró algo (penaltyChargedCents > 0) -- una cancelación
    // >72h con liberación completa del hold, sin cargo, no genera evento
    // de dinero real y no debe loguearse como tal.
    if (penaltyChargedCents > 0) {
      try {
        await supabase.from("shadow_ledger_entries").insert(
          buildShadowLedgerEntry({
            eventType: "cancellation_penalty",
            orderId,
            userId: order.user_id,
            amountCents: penaltyChargedCents,
            processor: order.payment_option === "paypal_first_time" ? "paypal" : "stripe",
            externalReference: payments.penalty || payments.hold || null,
            occurredAt: new Date(),
            metadata: { source: "orders_cancel_route", hoursUntilService: hoursLeft },
          })
        );
      } catch (shadowLedgerErr) {
        // La penalidad ya fue cobrada realmente (Stripe) -- un fallo al
        // registrar el shadow ledger no debe revertir la cancelación ya
        // procesada, pero queda logueado para reconciliación manual.
        console.error(`Shadow ledger insert failed for cancellation penalty on order ${orderId}:`, shadowLedgerErr);
      }
    }

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
          //
          // Fix F5 (auditoría operativa/contable 2026-07-21, verificado y
          // confirmado real): usaba p_type: "credit", que expira a los 12
          // meses (isExpiringWalletCreditType, src/lib/wallet.ts) -- pero
          // esto es dinero PROPIO del cliente que ya había aplicado a la
          // orden, devuelto porque la orden se canceló, no un incentivo
          // promocional nuevo. wallet.ts documenta explícitamente:
          // "Reembolsos... son dinero que ya era del cliente... nunca
          // expiran". Se corrige a 'refund' (valor válido en el CHECK de
          // wallet_transactions.type, migración 025).
          const { error: rpcError } = await supabase.rpc("apply_wallet_delta", {
            p_wallet_id: wallet.id,
            p_user_id: order.user_id,
            p_order_id: orderId,
            p_type: "refund",
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
    return safeErrorResponse(err);
  }
}

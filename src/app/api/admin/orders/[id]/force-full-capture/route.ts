import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { assertStripe } from "@/lib/stripe";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { safeErrorResponse } from "@/lib/api-errors";
import { isValidUuid } from "@/lib/validation";

/**
 * PATCH /api/admin/orders/[id]/force-full-capture
 *
 * v8.3 E2 (2026-07-13, decisión del dueño) — el admin ya revisó la evidencia
 * de una disputa crítica documentada y decide cobrar el TOTAL de inmediato
 * pese a la disputa (en vez de esperar a que resuelva la captura parcial +
 * remanente a 24h, o el skip total). Único punto de escritura de
 * `orders.capture_force_full_by` -- el sistema nunca fuerza esto solo.
 *
 * Cubre dos estados de partida distintos:
 *   A) La orden nunca capturó nada (skip total, capture_partial_at NULL):
 *      se captura el Hold + balance como en el flujo normal, por el total.
 *   B) La orden ya tuvo una captura parcial (capture_partial_at seteado):
 *      el Hold ya se consumió/liberó (limitación de Stripe, ver
 *      batch-capture-partial.ts) -- el remanente se cobra como un
 *      PaymentIntent nuevo off-session.
 *
 * "finance" ya es el recurso RBAC restringido a owner_admin (admin-rbac.ts)
 * -- se reutiliza porque esto es una decisión de cobro real, mismo nivel
 * de sensibilidad que pricing_settings/payroll.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  try {
    const body = await request.json();
    const { reason } = body as { reason?: string };

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required for the audit trail" }, { status: 400 });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, quote_id, user_id, status, payment_option, stripe_hold_payment_intent_id, stripe_customer_id, stripe_payment_method_id, hold_amount_cents, hold_authorized_amount_cents, hold_captured_at, capture_partial_at, capture_partial_amount, capture_remaining_amount, capture_remaining_captured_at, capture_force_full_by, card_amount_charged_cents, total_paid_cents, quotes(total)"
      )
      .eq("id", params.id)
      .is("deleted_at", null)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Fix A-3 (auditoría 2026-07-21): esta ruta nunca leía ni validaba
    // orders.status, permitiendo cobrar el total de una orden cancelada o
    // marcada no_show. Se bloquea explícitamente.
    if (order.status === "cancelled" || order.status === "no_show") {
      return NextResponse.json(
        { error: `Cannot force-capture an order in status '${order.status}'` },
        { status: 409 }
      );
    }

    if (order.capture_force_full_by) {
      return NextResponse.json({ error: "Already force-captured by an admin" }, { status: 409 });
    }
    if (order.capture_remaining_amount === 0 && order.capture_partial_at) {
      return NextResponse.json({ error: "Nothing left to capture — remainder already collected" }, { status: 409 });
    }
    if (order.payment_option !== "card") {
      return NextResponse.json(
        { error: "force-full-capture only supports card orders today (see batch-capture route scope note)" },
        { status: 400 }
      );
    }

    const quoteTotal = Math.round(Number((order.quotes as unknown as { total: number }[])?.[0]?.total ?? 0));
    if (quoteTotal <= 0) {
      return NextResponse.json({ error: "Missing quote total" }, { status: 400 });
    }

    const stripe = assertStripe();
    const neverCapturedAnything = !order.hold_captured_at && !order.capture_partial_at;

    let capturedNowCents = 0;
    let paymentIntentId: string | null = null;

    if (neverCapturedAnything) {
      // Caso A: nada se cobró todavía -- Hold + balance por el total, igual
      // que el flujo normal del batch de las 7PM.
      // RAÍZ-3 (2026-07-21, migración 229): hold_amount_cents/
      // hold_authorized_amount_cents ya están en centavos -- sin *100.
      const holdAmountCents = Math.min(
        Math.round(Math.max(0, order.hold_authorized_amount_cents || order.hold_amount_cents || 0)),
        quoteTotal * 100
      );
      const balanceCents = Math.max(0, quoteTotal * 100 - holdAmountCents);

      if (holdAmountCents > 0) {
        if (!order.stripe_hold_payment_intent_id) {
          return NextResponse.json({ error: "Missing hold PaymentIntent" }, { status: 400 });
        }
        const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
        if (holdPi.status === "requires_capture") {
          await stripe.paymentIntents.capture(
            order.stripe_hold_payment_intent_id,
            { amount_to_capture: holdAmountCents },
            { idempotencyKey: `${order.id}:force-full-hold-capture` }
          );
        } else if (holdPi.status !== "succeeded") {
          return NextResponse.json({ error: `Hold PaymentIntent status: ${holdPi.status}` }, { status: 409 });
        }
        capturedNowCents += holdAmountCents;
        paymentIntentId = order.stripe_hold_payment_intent_id;
      }

      if (balanceCents > 0) {
        if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
          return NextResponse.json({ error: "Missing customer or payment method" }, { status: 400 });
        }
        const balancePi = await stripe.paymentIntents.create(
          {
            amount: balanceCents,
            currency: "cad",
            customer: order.stripe_customer_id,
            payment_method: order.stripe_payment_method_id,
            payment_method_types: ["card"],
            capture_method: "automatic",
            confirm: true,
            off_session: true,
            description: `Admin-forced full capture for order ${order.id}`,
            metadata: {
              order_id: order.id,
              quote_id: order.quote_id,
              user_id: order.user_id,
              charge_type: "force_full_capture",
              forced_by: auth.user.id,
            },
          },
          { idempotencyKey: `${order.id}:force-full-balance` }
        );
        if (balancePi.status !== "succeeded") {
          return NextResponse.json({ error: `Balance PaymentIntent status: ${balancePi.status}` }, { status: 409 });
        }
        capturedNowCents += balanceCents;
        paymentIntentId = balancePi.id;
      }
    } else {
      // Caso B: ya hubo una captura parcial -- el Hold ya no sirve
      // (limitación de Stripe: una sola captura por PaymentIntent). Se
      // cobra el remanente pendiente como un cargo nuevo off-session.
      const remainingCents = Math.round((order.capture_remaining_amount || 0) * 100);
      if (remainingCents <= 0) {
        return NextResponse.json({ error: "No remaining amount to force-capture" }, { status: 409 });
      }
      if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
        return NextResponse.json({ error: "Missing customer or payment method" }, { status: 400 });
      }
      const pi = await stripe.paymentIntents.create(
        {
          amount: remainingCents,
          currency: "cad",
          customer: order.stripe_customer_id,
          payment_method: order.stripe_payment_method_id,
          payment_method_types: ["card"],
          capture_method: "automatic",
          confirm: true,
          off_session: true,
          description: `Admin-forced remainder capture for order ${order.id}`,
          metadata: {
            order_id: order.id,
            quote_id: order.quote_id,
            user_id: order.user_id,
            charge_type: "force_full_capture_remainder",
            forced_by: auth.user.id,
          },
        },
        { idempotencyKey: `${order.id}:force-full-remainder` }
      );
      if (pi.status !== "succeeded") {
        return NextResponse.json({ error: `Remainder PaymentIntent status: ${pi.status}` }, { status: 409 });
      }
      capturedNowCents = remainingCents;
      paymentIntentId = pi.id;
    }

    if (capturedNowCents > 0) {
      await supabase.from("shadow_ledger_entries").insert(
        buildShadowLedgerEntry({
          eventType: "balance_captured",
          orderId: order.id,
          userId: order.user_id,
          amountCents: capturedNowCents,
          processor: "stripe",
          externalReference: paymentIntentId,
          occurredAt: new Date(),
          metadata: { forced_full_capture: true, forced_by: auth.user.id, reason: reason.trim() },
        })
      );
    }

    // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents/
    // card_amount_charged_cents ya están en centavos -- se suma
    // capturedNowCents directo, sin dividir a dólares.
    const previousTotalPaidCents = Number(order.total_paid_cents || 0);
    const previousCardChargedCents = Number(order.card_amount_charged_cents || 0);
    const capturedNowDollars = capturedNowCents / 100; // solo para el mensaje/response al admin

    const { data: updated, error: updateError } = await supabase
      .from("orders")
      .update({
        capture_force_full_by: auth.user.id,
        capture_force_full_at: new Date().toISOString(),
        capture_force_full_reason: reason.trim(),
        capture_remaining_amount: 0,
        capture_remaining_captured_at: new Date().toISOString(),
        hold_captured_at: order.hold_captured_at || (neverCapturedAnything ? new Date().toISOString() : order.hold_captured_at),
        total_paid_cents: previousTotalPaidCents + capturedNowCents,
        card_amount_charged_cents: previousCardChargedCents + capturedNowCents,
        // Fix B-P0-1 (auditoría 2026-07-21): si esta orden había fallado en
        // el batch de las 7PM (capture_attempts >= 1), el retry de las 10PM
        // no filtraba capture_force_full_by y volvía a cobrarla completa
        // (doble cobro real). Se resetea aquí como defensa adicional a la
        // exclusión explícita agregada en batch-capture-retry.
        capture_attempts: 0,
        capture_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .select()
      .single();

    if (updateError) {
      console.error("force-full-capture order update error:", updateError);
      return NextResponse.json(
        { error: `Captured ${capturedNowDollars} but failed to update order record: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { order: updated, capturedNowDollars, paymentIntentId },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

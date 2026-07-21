import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";

/**
 * POST /api/cron/hold-authorize
 *
 * Job programado cada hora (America/Vancouver).
 * Autoriza un hold manual-capture para órdenes con tarjeta cuyo servicio
 * comienza dentro de las próximas 72 horas (T-72h) y aún no tienen hold.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const HOURS_WINDOW = 72;
const MAX_ATTEMPTS = 3;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const stripe = assertStripe();
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const windowStart = now.toISOString();
  const windowEnd = new Date(now.getTime() + HOURS_WINDOW * 60 * 60 * 1000).toISOString();

  try {
    // Órdenes de tarjeta confirmadas, con servicio en las próximas 72h,
    // que aún no tienen hold y no han superado los reintentos.
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, quote_id, user_id, service_datetime, stripe_customer_id, stripe_payment_method_id, hold_amount_cents, hold_attempts, quotes(total)")
      .eq("payment_option", "card")
      .is("stripe_hold_payment_intent_id", null)
      .gte("service_datetime", windowStart)
      .lte("service_datetime", windowEnd)
      .not("status", "in", "(cancelled,no_show)")
      .lt("hold_attempts", MAX_ATTEMPTS)
      .order("service_datetime", { ascending: true });

    if (error) {
      console.error("Hold authorize fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = {
      processed: 0,
      authorized: 0,
      failed: 0,
      skipped: 0,
      errors: [] as { orderId: string; error: string }[],
    };

    for (const order of orders || []) {
      results.processed++;

      const paymentMethodId = order.stripe_payment_method_id;
      const customerId = order.stripe_customer_id;
      // Spec v8.2: Hold = MAX(fórmula_base, 40% del total). Nunca autorizar el total.
      // RAÍZ-3 (2026-07-21, migración 229): hold_amount_cents ya está en
      // centavos -- holdAmountCents se usa directo contra Stripe, sin *100.
      const holdAmountCents = Math.max(0, Math.round(Number(order.hold_amount_cents ?? 0)));

      if (!paymentMethodId || !customerId || holdAmountCents <= 0) {
        results.skipped++;
        results.errors.push({
          orderId: order.id,
          error: "Missing payment method, customer, or hold amount",
        });
        await supabase
          .from("orders")
          .update({
            hold_attempts: (order.hold_attempts ?? 0) + 1,
            hold_last_error: "Missing payment method, customer, or hold amount",
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
        continue;
      }

      try {
        const paymentIntent = await stripe.paymentIntents.create(
          {
            amount: holdAmountCents, // RAÍZ-3: ya en centavos, sin *100
            currency: "cad",
            customer: customerId,
            payment_method: paymentMethodId,
            payment_method_types: ["card"],
            capture_method: "manual",
            confirmation_method: "manual",
            confirm: true,
            off_session: true,
            description: `Hold T-72h for order ${order.id}`,
            metadata: {
              order_id: order.id,
              quote_id: order.quote_id,
              user_id: order.user_id,
              hold_type: "t72h",
              hold_amount_cents: holdAmountCents,
            },
          },
          { idempotencyKey: `${order.id}:hold-authorize` }
        );

        if (paymentIntent.status !== "requires_capture") {
          throw new Error(`Unexpected PaymentIntent status: ${paymentIntent.status}`);
        }

        await supabase
          .from("orders")
          .update({
            stripe_hold_payment_intent_id: paymentIntent.id,
            hold_authorized_amount_cents: holdAmountCents,
            hold_authorized_at: new Date().toISOString(),
            hold_attempts: 0,
            hold_last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        results.authorized++;
      } catch (err: Error | unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : "Unknown hold error";
        results.errors.push({ orderId: order.id, error: message });
        console.error(`Hold authorize failed for order ${order.id}:`, err);

        await supabase
          .from("orders")
          .update({
            hold_attempts: (order.hold_attempts ?? 0) + 1,
            hold_last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
      }
    }

    return NextResponse.json(
      {
        success: true,
        windowStart,
        windowEnd,
        ...results,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Hold authorize job error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

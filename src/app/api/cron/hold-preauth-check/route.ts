import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { decideHoldRevalidationAction } from "@/lib/hold-revalidation";

/**
 * GET /api/cron/hold-preauth-check
 *
 * Job programado a las 17:00 hora Vancouver — 2 horas ANTES del Batch
 * Capture de las 7PM (/api/cron/batch-capture, vercel.json "0 2,3 * * *").
 * Este cron corre a "0 0,1 * * *" UTC (doble disparo por PDT/PST, mismo
 * patrón que batch-capture) para cubrir 17:00 tanto en horario de verano
 * (UTC-7) como estándar (UTC-8).
 *
 * v8.3 E2.10 (auditoría 2026-07-18) — bug MEDIO: no existía ninguna
 * revalidación del hold de tarjeta entre su creación (T-72h,
 * /api/cron/hold-authorize) y el capture (T-0, 7PM). Si el hold expiró,
 * el banco lo canceló, o la tarjeta fue rechazada en el ínterin, el
 * primer punto donde se descubría era la noche del servicio, ya sin
 * margen operativo para resolverlo antes de que el equipo se fuera del
 * sitio. Este job recupera el PaymentIntent de cada orden con servicio
 * HOY, y si ya no está en 'requires_capture', intenta re-autorizar un
 * nuevo hold silenciosamente (mismo monto, misma tarjeta) antes de
 * rendirse y escalar a ops via tickets_disputas.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const MAX_REAUTH_ATTEMPTS = 3;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
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
  const nowIso = new Date().toISOString();

  // Ventana de "hoy" (Vancouver) — solo revalidamos órdenes cuyo servicio
  // es hoy, ya que son las que entrarán al Batch Capture de esta noche.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 2); // margen generoso de zona horaria

  const results = {
    processed: 0,
    stillValid: 0,
    reauthorized: 0,
    reauthFailed: 0,
    escalatedToOps: 0,
    errors: [] as { orderId: string; error: string }[],
  };

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, quote_id, user_id, service_datetime, stripe_customer_id, stripe_payment_method_id, stripe_hold_payment_intent_id, hold_authorized_amount, hold_amount, hold_reauth_attempts"
      )
      .eq("payment_option", "card")
      .not("stripe_hold_payment_intent_id", "is", null)
      .not("status", "in", "(cancelled,no_show)")
      .gte("service_datetime", todayStart.toISOString())
      .lte("service_datetime", todayEnd.toISOString());

    if (error) {
      console.error("Hold preauth-check fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const order of orders || []) {
      results.processed++;

      let holdStatus: string | null = null;
      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id as string);
        holdStatus = pi.status;
      } catch (err: Error | unknown) {
        holdStatus = null;
        console.error(`Hold preauth-check: retrieve failed for order ${order.id}:`, err);
      }

      const reauthAttempts = order.hold_reauth_attempts ?? 0;
      const decision = decideHoldRevalidationAction({
        holdStatus,
        reauthAttempts,
        maxReauthAttempts: MAX_REAUTH_ATTEMPTS,
      });

      if (decision.action === "hold_valid") {
        results.stillValid++;
        await supabase
          .from("orders")
          .update({ hold_preauth_checked_at: nowIso })
          .eq("id", order.id);
        continue;
      }

      if (decision.action === "give_up_notify_ops") {
        results.escalatedToOps++;
        await supabase
          .from("orders")
          .update({
            hold_preauth_checked_at: nowIso,
            hold_reauth_last_error: decision.reason,
          })
          .eq("id", order.id);

        await supabase.from("tickets_disputas").insert({
          order_id: order.id,
          type: "discrepancy",
          priority: "high",
          status: "open",
          context: {
            source: "hold_preauth_check",
            reason: decision.reason,
            stripeHoldPaymentIntentId: order.stripe_hold_payment_intent_id,
            holdStatus,
          },
        });
        continue;
      }

      // decision.action === "needs_reauth" — reintentar hold silenciosamente
      // con el mismo monto/tarjeta antes del Batch Capture de esta noche.
      const paymentMethodId = order.stripe_payment_method_id;
      const customerId = order.stripe_customer_id;
      const holdAmount = Math.max(
        0,
        Math.round(Number(order.hold_authorized_amount ?? order.hold_amount ?? 0))
      );

      if (!paymentMethodId || !customerId || holdAmount <= 0) {
        results.reauthFailed++;
        const message = "Missing payment method, customer, or hold amount for re-auth";
        results.errors.push({ orderId: order.id, error: message });
        await supabase
          .from("orders")
          .update({
            hold_preauth_checked_at: nowIso,
            hold_reauth_attempts: reauthAttempts + 1,
            hold_reauth_last_error: message,
          })
          .eq("id", order.id);
        continue;
      }

      try {
        const newPi = await stripe.paymentIntents.create({
          amount: holdAmount * 100,
          currency: "cad",
          customer: customerId,
          payment_method: paymentMethodId,
          payment_method_types: ["card"],
          capture_method: "manual",
          confirmation_method: "manual",
          confirm: true,
          off_session: true,
          description: `Hold re-auth T-2h for order ${order.id}`,
          metadata: {
            order_id: order.id,
            quote_id: order.quote_id,
            user_id: order.user_id,
            hold_type: "t2h_reauth",
            hold_amount: holdAmount,
          },
        });

        if (newPi.status !== "requires_capture") {
          throw new Error(`Unexpected PaymentIntent status on re-auth: ${newPi.status}`);
        }

        await supabase
          .from("orders")
          .update({
            stripe_hold_payment_intent_id: newPi.id,
            hold_authorized_amount: holdAmount,
            hold_authorized_at: nowIso,
            hold_preauth_checked_at: nowIso,
            hold_reauth_attempts: 0,
            hold_reauth_last_error: null,
          })
          .eq("id", order.id);

        results.reauthorized++;
      } catch (err: Error | unknown) {
        results.reauthFailed++;
        const message = err instanceof Error ? err.message : "Unknown re-auth error";
        results.errors.push({ orderId: order.id, error: message });
        console.error(`Hold preauth-check: re-auth failed for order ${order.id}:`, err);

        const attemptsAfter = reauthAttempts + 1;
        await supabase
          .from("orders")
          .update({
            hold_preauth_checked_at: nowIso,
            hold_reauth_attempts: attemptsAfter,
            hold_reauth_last_error: message.slice(0, 500),
          })
          .eq("id", order.id);

        // Si este intento fallido ya alcanza el tope, escalar a ops ahora
        // mismo en vez de esperar a la próxima corrida (no habrá próxima
        // corrida útil antes del Batch Capture de hoy).
        if (attemptsAfter >= MAX_REAUTH_ATTEMPTS) {
          results.escalatedToOps++;
          await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "discrepancy",
            priority: "high",
            status: "open",
            context: {
              source: "hold_preauth_check",
              reason: `Re-auth silenciosa falló ${attemptsAfter} veces: ${message}`,
              stripeHoldPaymentIntentId: order.stripe_hold_payment_intent_id,
              holdStatus,
            },
          });
        }
      }
    }

    return NextResponse.json({ success: true, ...results }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Hold preauth-check job error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

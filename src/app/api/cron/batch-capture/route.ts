import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { getVancouverTodayString } from "@/lib/date-utils";

/**
 * POST /api/cron/batch-capture
 *
 * Job programado para ejecutarse todos los días a las 7:00 PM hora Vancouver.
 * Vercel Cron corre en UTC, por eso se invoca 2 veces (2 AM y 3 AM UTC)
 * y dentro se verifica que en Vancouver sea exactamente las 19:00.
 *
 * Procesa órdenes completadas del día (service_date = hoy Vancouver) que aún
 * no hayan sido cobradas. Implementa el flujo v8.2:
 *  - Tarjeta: captura el Hold + crea un PaymentIntent por el saldo restante.
 *  - PayPal primer servicio: el anticipo ya fue pagado; se cobra el saldo restante
 *    por Stripe (la tarjeta estaba obligatoria en la reserva).
 *
 * Exclusión del batch: orden con reclamo de garantía abierto (warranty_claims.status='open').
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const MAX_ATTEMPTS = 3;

interface OrderRow {
  id: string;
  quote_id: string;
  user_id: string;
  payment_option: "card" | "paypal_first_time";
  stripe_hold_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  hold_amount: number;
  hold_authorized_amount: number;
  hold_captured_at: string | null;
  paypal_advance_amount: number;
  capture_attempts: number;
  quotes: { total: number }[] | null;
}

function vancouverHour(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? -1);
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Vercel Cron corre en UTC. 7 PM Vancouver puede ser 2 AM o 3 AM UTC según DST.
  // Solo procesamos si en Vancouver son aproximadamente las 7 PM.
  if (vancouverHour() !== 19) {
    return NextResponse.json({ skipped: true, reason: "Not 7 PM Vancouver" }, { status: 200 });
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
  const todayStr = getVancouverTodayString();

  // Guard contra doble ejecución: ya corrido hoy?
  const { data: alreadyRan } = await supabase
    .from("dispatch_runs")
    .select("id")
    .eq("run_date", todayStr)
    .eq("phase", "published")
    .limit(1);

  if (alreadyRan && alreadyRan.length > 0) {
    return NextResponse.json(
      { skipped: true, reason: "Batch capture already ran today", date: todayStr },
      { status: 200 }
    );
  }

  // Marcar inicio del run
  const { data: runRow } = await supabase
    .from("dispatch_runs")
    .insert({
      run_date: todayStr,
      phase: "published",
      triggered_at: new Date().toISOString(),
      notes: "Batch capture 7PM Vancouver",
    })
    .select("id")
    .single();
  const runId = runRow?.id;

  // Feature flags
  const [{ data: chargebackFlag }, { data: qboFlag }] = await Promise.all([
    supabase.from("feature_flags").select("activo").eq("nombre", "chargeback_reserve_enabled").single(),
    supabase.from("feature_flags").select("activo").eq("nombre", "qbo_export_enabled").single(),
  ]);
  const chargebackEnabled = !!chargebackFlag?.activo;
  const qboEnabled = !!qboFlag?.activo;

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, quote_id, user_id, payment_option, stripe_hold_payment_intent_id, stripe_customer_id, stripe_payment_method_id, hold_amount, hold_authorized_amount, paypal_advance_amount, capture_attempts, quotes(total)"
      )
      .eq("service_date", todayStr)
      .eq("status", "completed")
      .not("status", "in", ["cancelled", "no_show"])
      .lt("capture_attempts", MAX_ATTEMPTS)
      .order("service_datetime", { ascending: true });

    if (error) {
      console.error("Batch capture fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = {
      processed: 0,
      captured: 0,
      failed: 0,
      skipped: 0,
      errors: [] as { orderId: string; error: string }[],
    };

    for (const order of (orders as unknown as OrderRow[]) || []) {
      results.processed++;

      const quoteTotal = Math.round(Number(order.quotes?.[0]?.total ?? 0));
      if (quoteTotal <= 0) {
        results.skipped++;
        results.errors.push({ orderId: order.id, error: "Missing quote total" });
        continue;
      }

      // Exclusión del batch: reclamo de garantía abierto
      const { data: openClaims } = await supabase
        .from("warranty_claims")
        .select("id")
        .eq("order_id", order.id)
        .eq("status", "open")
        .limit(1);

      if (openClaims && openClaims.length > 0) {
        results.skipped++;
        results.errors.push({ orderId: order.id, error: "Open warranty claim" });
        continue;
      }

      try {
        let amountCharged = 0;
        const payments: { hold?: string; balance?: string } = {};

        if (order.payment_option === "card") {
          // Tarjeta: capturar Hold + cobrar saldo restante.
          const holdAmount = Math.min(
            Math.max(0, order.hold_authorized_amount || order.hold_amount || 0),
            quoteTotal
          );
          const balanceAmount = Math.max(0, quoteTotal - holdAmount);

          if (holdAmount > 0) {
            if (!order.stripe_hold_payment_intent_id) {
              throw new Error("Missing hold PaymentIntent for card order");
            }
            const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
            if (holdPi.status === "requires_capture") {
              await stripe.paymentIntents.capture(order.stripe_hold_payment_intent_id, {
                amount_to_capture: holdAmount * 100,
              });
            } else if (holdPi.status !== "succeeded") {
              throw new Error(`Hold PaymentIntent status: ${holdPi.status}`);
            }
            payments.hold = order.stripe_hold_payment_intent_id;
            amountCharged += holdAmount;
          }

          if (balanceAmount > 0) {
            if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
              throw new Error("Missing customer or payment method for balance charge");
            }
            const balancePi = await stripe.paymentIntents.create({
              amount: balanceAmount * 100,
              currency: "cad",
              customer: order.stripe_customer_id,
              payment_method: order.stripe_payment_method_id,
              payment_method_types: ["card"],
              capture_method: "automatic",
              confirm: true,
              off_session: true,
              description: `Balance for order ${order.id}`,
              metadata: {
                order_id: order.id,
                quote_id: order.quote_id,
                user_id: order.user_id,
                charge_type: "balance",
              },
            });
            if (balancePi.status !== "succeeded") {
              throw new Error(`Balance PaymentIntent status: ${balancePi.status}`);
            }
            payments.balance = balancePi.id;
            amountCharged += balanceAmount;
          }
        } else if (order.payment_option === "paypal_first_time") {
          // PayPal: el anticipo ya fue cobrado. Solo cobrar el saldo restante por Stripe.
          const paypalAdvance = Math.min(
            Math.max(0, order.paypal_advance_amount || Math.round(order.hold_amount * 0.5)),
            quoteTotal
          );
          const balanceAmount = Math.max(0, quoteTotal - paypalAdvance);

          if (balanceAmount > 0) {
            if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
              throw new Error("Missing card registration for PayPal order balance charge");
            }
            const balancePi = await stripe.paymentIntents.create({
              amount: balanceAmount * 100,
              currency: "cad",
              customer: order.stripe_customer_id,
              payment_method: order.stripe_payment_method_id,
              payment_method_types: ["card"],
              capture_method: "automatic",
              confirm: true,
              off_session: true,
              description: `Balance for PayPal order ${order.id}`,
              metadata: {
                order_id: order.id,
                quote_id: order.quote_id,
                user_id: order.user_id,
                charge_type: "paypal_balance",
                paypal_advance: paypalAdvance,
              },
            });
            if (balancePi.status !== "succeeded") {
              throw new Error(`PayPal balance PaymentIntent status: ${balancePi.status}`);
            }
            payments.balance = balancePi.id;
            amountCharged += balanceAmount;
          }

          // Cancelar cualquier hold autorizado para este pedido PayPal (no debería existir,
          // pero si existe lo liberamos porque el anticipo PayPal cubre la garantía).
          if (order.stripe_hold_payment_intent_id) {
            try {
              const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
              if (holdPi.status === "requires_capture") {
                await stripe.paymentIntents.cancel(order.stripe_hold_payment_intent_id);
              }
            } catch (err) {
              console.warn(`Could not cancel hold for PayPal order ${order.id}:`, err);
            }
          }
        }

        // Stripe fee aproximada para QBO (2.9% + 0.30 CAD)
        const stripeFeeCents = Math.round(amountCharged * 100 * 0.029 + 30);

        await supabase
          .from("orders")
          .update({
            hold_captured_at: payments.hold ? new Date().toISOString() : order.hold_captured_at,
            stripe_capture_payment_intent_id: payments.balance || null,
            capture_captured_at: payments.balance ? new Date().toISOString() : null,
            capture_authorized_amount: amountCharged,
            total_paid: amountCharged + (order.payment_option === "paypal_first_time" ? order.paypal_advance_amount : 0),
            card_amount_charged: amountCharged,
            capture_attempts: 0,
            capture_last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        // Chargeback reserve
        if (chargebackEnabled && amountCharged > 0) {
          const { data: settings } = await supabase
            .from("chargeback_settings")
            .select("reserve_percentage, reserve_cap_amount")
            .order("effective_from", { ascending: false })
            .limit(1)
            .single();

          const reservePercentage = settings?.reserve_percentage ? Number(settings.reserve_percentage) : 2.0;
          const reserveCap = settings?.reserve_cap_amount ? Number(settings.reserve_cap_amount) : null;
          let reserveAmount = Math.round((amountCharged * 100) * (reservePercentage / 100));
          if (reserveCap !== null && reserveCap > 0) {
            reserveAmount = Math.min(reserveAmount, reserveCap);
          }

          await supabase.from("chargeback_reserves").insert({
            order_id: order.id,
            payment_intent_id: payments.balance || payments.hold || null,
            captured_amount: amountCharged * 100,
            reserve_percentage: reservePercentage,
            reserve_amount: reserveAmount,
            released_amount: 0,
            status: "held",
            release_date: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          });
        }

        // QBO export line (determinista)
        if (qboEnabled && amountCharged > 0) {
          await supabase.from("qbo_export_lines").insert({
            export_id: null,
            order_id: order.id,
            payment_intent_id: payments.balance || payments.hold || null,
            transaction_type: "capture",
            transaction_date: new Date().toISOString(),
            gross_amount: amountCharged * 100,
            fee_amount: stripeFeeCents,
            net_amount: amountCharged * 100 - stripeFeeCents,
            description: `Capture order ${order.id}`,
          });
        }

        results.captured++;
      } catch (err: Error | unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : "Unknown capture error";
        results.errors.push({ orderId: order.id, error: message });
        console.error(`Batch capture failed for order ${order.id}:`, err);

        await supabase
          .from("orders")
          .update({
            capture_attempts: (order.capture_attempts ?? 0) + 1,
            capture_last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
      }
    }

    // Marcar fin del run
    if (runId) {
      await supabase
        .from("dispatch_runs")
        .update({
          completed_at: new Date().toISOString(),
          orders_processed: results.processed,
          orders_assigned: results.captured,
        })
        .eq("id", runId);
    }

    return NextResponse.json(
      {
        success: true,
        date: todayStr,
        chargebackEnabled,
        qboEnabled,
        ...results,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Batch capture job error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

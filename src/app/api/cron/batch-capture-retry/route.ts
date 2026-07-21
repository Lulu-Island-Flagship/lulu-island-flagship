import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { getVancouverTodayString } from "@/lib/date-utils";
import { buildPaymentUpdateLink } from "@/lib/sms";
import { calculateReserveSplit } from "@/lib/cash-reserve";
import { dispatchCommunication } from "@/lib/send-communication";
import {
  evaluateCaptureEligibility,
  type OrderClaimForCaptureDecision,
} from "@/lib/batch-capture-eligibility";

/**
 * POST /api/cron/batch-capture-retry
 *
 * Job programado para ejecutarse todos los días a las 10:00 PM hora
 * Vancouver (v8.3 E2.3 / excepción D.10.9): "falla → SMS con link de
 * actualización → retry 10 PM → admin."
 *
 * Reintenta el cobro de las órdenes de HOY cuyo Batch Capture de las 7PM
 * falló (capture_attempts >= 1) y todavía no agotaron MAX_ATTEMPTS. Si el
 * reintento también falla y se agotan los MAX_ATTEMPTS, dispara la
 * notificación SMS (interfaz en src/lib/sms.ts, sin proveedor real
 * todavía) y escala a la bandeja unificada (tickets_disputas).
 *
 * Vercel Cron corre en UTC, por eso se invoca 2 veces (5 AM y 6 AM UTC)
 * y dentro se verifica que en Vancouver sea exactamente las 22:00.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const MAX_ATTEMPTS = 3;
const JOB_NAME = "batch_capture_retry";

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

  // 10 PM Vancouver puede ser 5 AM o 6 AM UTC según DST.
  if (vancouverHour() !== 22) {
    return NextResponse.json({ skipped: true, reason: "Not 10 PM Vancouver" }, { status: 200 });
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
  const todayStr = getVancouverTodayString();

  // Guard contra doble ejecución (tabla genérica, migración 073).
  const { data: alreadyRan } = await supabase
    .from("cron_execution_guard")
    .select("job_name")
    .eq("job_name", JOB_NAME)
    .eq("run_date", todayStr)
    .maybeSingle();

  if (alreadyRan) {
    return NextResponse.json(
      { skipped: true, reason: "Batch capture retry already ran today", date: todayStr },
      { status: 200 }
    );
  }

  const { data: retryFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "batch_capture_retry_enabled")
    .single();
  const retryEnabled = !!retryFlag?.activo;

  const { data: chargebackFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "chargeback_reserve_enabled")
    .single();
  const chargebackEnabled = !!chargebackFlag?.activo;

  const { data: cashReserveFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "cash_reserve_tracking_enabled")
    .single();
  const cashReserveEnabled = !!cashReserveFlag?.activo;

  // v8.3 AUDITORÍA RESERVA→DINERO→RESEÑA: hallazgo real. batch-capture (7PM)
  // re-evalúa evaluateCaptureEligibility antes de cobrar y excluye una orden
  // con disputa crítica documentada (B.2.2/B.2.18); este retry de las 10PM
  // NUNCA hacía esa misma verificación. Una orden podía fallar a las 7PM por
  // una razón sin relación (tarjeta rechazada, red caída) y, si entre las
  // 7PM y las 10PM el cliente abría una disputa crítica con evidencia, el
  // retry la cobraba igual, saltándose por completo la salvaguarda que sí
  // aplica el cron principal. Mismo flag, misma función pura testeada.
  const { data: disputeExclusionFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "batch_capture_dispute_exclusion_enabled")
    .single();
  const disputeExclusionEnabled = !!disputeExclusionFlag?.activo;

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.luluisland.com";

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, quote_id, user_id, payment_option, stripe_hold_payment_intent_id, stripe_customer_id, stripe_payment_method_id, hold_amount, hold_authorized_amount, paypal_advance_amount, capture_attempts, quotes(total)"
      )
      .eq("service_date", todayStr)
      .eq("status", "completed")
      .not("status", "in", "(cancelled,no_show)")
      .gte("capture_attempts", 1)
      .lt("capture_attempts", MAX_ATTEMPTS)
      .order("service_datetime", { ascending: true });

    if (error) {
      console.error("Batch capture retry fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results = {
      processed: 0,
      captured: 0,
      failed: 0,
      escalated: 0,
      errors: [] as { orderId: string; error: string }[],
    };

    if (!retryEnabled) {
      await supabase.from("cron_execution_guard").insert({ job_name: JOB_NAME, run_date: todayStr });
      return NextResponse.json(
        {
          success: true,
          dryRun: true,
          reason: "batch_capture_retry_enabled flag is off — decisión pendiente del dueño",
          date: todayStr,
          candidateOrders: (orders as unknown as OrderRow[])?.length ?? 0,
        },
        { status: 200 }
      );
    }

    const stripe = assertStripe();

    for (const order of (orders as unknown as OrderRow[]) || []) {
      results.processed++;

      const quoteTotal = Math.round(Number(order.quotes?.[0]?.total ?? 0));
      if (quoteTotal <= 0) {
        results.errors.push({ orderId: order.id, error: "Missing quote total" });
        continue;
      }

      if (disputeExclusionEnabled) {
        const { data: claimRows } = await supabase
          .from("warranty_claims")
          .select("id, status, severity, warranty_photo_evidence(photo_type)")
          .eq("order_id", order.id);

        const claimsForDecision: OrderClaimForCaptureDecision[] = (claimRows ?? []).map((c) => ({
          id: c.id as string,
          status: c.status as OrderClaimForCaptureDecision["status"],
          severity: (c.severity as OrderClaimForCaptureDecision["severity"]) ?? "minor",
          hasClientEvidence: Array.isArray(c.warranty_photo_evidence)
            ? c.warranty_photo_evidence.some((e: { photo_type: string }) => e.photo_type === "client")
            : false,
        }));

        const eligibility = evaluateCaptureEligibility(claimsForDecision);

        if (!eligibility.shouldCapture) {
          // Mismo criterio que el cron de las 7PM: no cobrar sobre una
          // disputa crítica documentada abierta. No se reintenta la
          // captura parcial aquí (ese camino ya corrió o no aplicó a las
          // 7PM) -- se deja en revisión manual explícita en vez de arriesgar
          // un cobro que la garantía ya bloqueó una vez.
          await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "discrepancy",
            priority: "high",
            status: "open",
            context: {
              reason: "batch_capture_retry_withheld_critical_dispute",
              warranty_claim_id: eligibility.blockingClaimId,
              quote_total: quoteTotal,
              source: "batch_capture_retry",
            },
          });
          results.errors.push({
            orderId: order.id,
            error: `WITHHELD: ${eligibility.reason} (claim ${eligibility.blockingClaimId}) — not retried`,
          });
          continue;
        }
      }

      try {
        let amountCharged = 0;
        const payments: { hold?: string; balance?: string } = {};

        if (order.payment_option === "card") {
          const holdAmount = Math.min(
            Math.max(0, order.hold_authorized_amount || order.hold_amount || 0),
            quoteTotal
          );
          const balanceAmount = Math.max(0, quoteTotal - holdAmount);

          if (holdAmount > 0 && !order.hold_captured_at) {
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
              description: `Balance retry (10PM) for order ${order.id}`,
              metadata: {
                order_id: order.id,
                quote_id: order.quote_id,
                user_id: order.user_id,
                charge_type: "balance_retry_10pm",
              },
            });
            if (balancePi.status !== "succeeded") {
              throw new Error(`Balance PaymentIntent status: ${balancePi.status}`);
            }
            payments.balance = balancePi.id;
            amountCharged += balanceAmount;
          }
        } else if (order.payment_option === "paypal_first_time") {
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
              description: `PayPal balance retry (10PM) for order ${order.id}`,
              metadata: {
                order_id: order.id,
                quote_id: order.quote_id,
                user_id: order.user_id,
                charge_type: "paypal_balance_retry_10pm",
                paypal_advance: paypalAdvance,
              },
            });
            if (balancePi.status !== "succeeded") {
              throw new Error(`PayPal balance PaymentIntent status: ${balancePi.status}`);
            }
            payments.balance = balancePi.id;
            amountCharged += balanceAmount;
          }
        }

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

        if (chargebackEnabled && amountCharged > 0) {
          const { data: settings } = await supabase
            .from("chargeback_settings")
            .select("reserve_percentage, reserve_cap_amount")
            .order("effective_from", { ascending: false })
            .limit(1)
            .single();

          const reservePercentage = settings?.reserve_percentage ? Number(settings.reserve_percentage) : 2.0;
          const reserveCap = settings?.reserve_cap_amount ? Number(settings.reserve_cap_amount) : null;
          let reserveAmount = Math.round(amountCharged * 100 * (reservePercentage / 100));
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

        if (cashReserveEnabled && amountCharged > 0) {
          const split = calculateReserveSplit({ grossAmountCents: amountCharged * 100 });
          await supabase.from("cash_tax_reserve_ledger").insert({
            order_id: order.id,
            gross_amount_cents: split.grossAmountCents,
            tip_amount_cents: split.tipAmountCents,
            non_taxable_amount_cents: split.nonTaxableAmountCents,
            taxable_base_cents: split.taxableBaseCents,
            tax_reserve_cents: split.taxReserveCents,
            operational_amount_cents: split.operationalAmountCents,
            reserve_rate: split.reserveRate,
          });
        }

        results.captured++;
      } catch (err: Error | unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : "Unknown retry capture error";
        results.errors.push({ orderId: order.id, error: message });
        console.error(`Batch capture retry failed for order ${order.id}:`, err);

        const newAttempts = (order.capture_attempts ?? 0) + 1;

        await supabase
          .from("orders")
          .update({
            capture_attempts: newAttempts,
            capture_last_error: message.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        // MAX_ATTEMPTS agotados: SMS + escalar a la bandeja unificada (D.10.9).
        if (newAttempts >= MAX_ATTEMPTS) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", order.user_id)
            .maybeSingle();
          const { data: clientProfile } = await supabase
            .from("client_profiles")
            .select("preferred_languages")
            .eq("user_id", order.user_id)
            .maybeSingle();
          const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] ||
            "en") as "en" | "es" | "zh";

          const paymentLink = buildPaymentUpdateLink(order.id, appBaseUrl);

          // v8.3 E6 (Auditoría E6): antes se llamaba sendPaymentUpdateSms
          // directo, con el mensaje hardcodeado fuera del catálogo
          // (communication_events/communication_templates, migración 045) y
          // sin pasar por arbitrateThrottle ni quedar en communication_log.
          // dispatchCommunication reusa la plantilla 'payment_failed'
          // (migración 185) igual que cualquier otro evento del catálogo.
          const dispatchResult = await dispatchCommunication(supabase, {
            eventKey: "payment_failed",
            userId: order.user_id,
            orderId: order.id,
            language,
            vars: {
              client_name: profile?.full_name || "cliente",
              order_id: order.id,
              payment_link: paymentLink,
            },
          });

          await supabase.from("payment_recovery_notifications").insert({
            order_id: order.id,
            channel: "sms",
            trigger_reason: "capture_attempts_exhausted",
            payment_link: paymentLink,
            status: dispatchResult.status,
            provider_response: dispatchResult.detail ?? null,
          });

          await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "payment_failure",
            priority: "high",
            status: "open",
            context: {
              reason: "capture_attempts_exhausted",
              max_attempts: MAX_ATTEMPTS,
              last_error: message.slice(0, 500),
              sms_status: dispatchResult.status,
            },
          });

          results.escalated++;
        }
      }
    }

    await supabase.from("cron_execution_guard").insert({ job_name: JOB_NAME, run_date: todayStr });

    return NextResponse.json(
      {
        success: true,
        date: todayStr,
        chargebackEnabled,
        ...results,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Batch capture retry job error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

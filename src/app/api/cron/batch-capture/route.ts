import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { getVancouverTodayString } from "@/lib/date-utils";
import { calculateReserveSplit } from "@/lib/cash-reserve";
import {
  evaluateCaptureEligibility,
  evaluateQcGate,
  type OrderClaimForCaptureDecision,
  type QcReviewStatus,
} from "@/lib/batch-capture-eligibility";
import { computePartialCaptureDecision } from "@/lib/batch-capture-partial";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";

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
 * Exclusión del batch (v8.3 B.2.2 / B.2.18 / E2.3, migración 080): SOLO se
 * excluye una orden con disputa de garantía que sea a la vez status='open',
 * severity='critical' y con evidencia fotográfica aportada por el cliente
 * ("crítica documentada"). Cualquier otra disputa abierta (minor, o critical
 * sin evidencia) NO congela el cobro — el pago no se congela por defecto.
 * La decisión es una función pura (src/lib/batch-capture-eligibility.ts)
 * para que sea testeable sin DB. Detrás de feature flag
 * 'batch_capture_dispute_exclusion_enabled' (apagado por defecto): mientras
 * esté apagado, el comportamiento es el histórico (se cobra siempre y se
 * deja nota informativa), igual que los demás flags de dinero del módulo.
 * Las órdenes excluidas quedan en orders.capture_withheld_* y se encolan en
 * tickets_disputas (type='discrepancy', priority='high') para revisión
 * manual explícita (punto B.3.3: humano solo si la evidencia no es
 * concluyente).
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
  capture_force_full_by: string | null;
  wallet_amount_used: number | null;
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
  // v8.3 fix (auditoría 2026-07-15): antes usaba phase='published', que
  // dispatch-scheduler también escribe (para el día siguiente) al publicar
  // equipos a las 17:30 -- eso hacía que este guard SIEMPRE encontrara una
  // fila "ya corrida" y el cobro de saldo restante nunca se ejecutara. Usa
  // su propia fase dedicada ('batch_capture', migración 178) para no
  // colisionar con el scheduler de despacho ni disparar su trigger de
  // publicación de slots.
  const { data: alreadyRan } = await supabase
    .from("dispatch_runs")
    .select("id")
    .eq("run_date", todayStr)
    .eq("phase", "batch_capture")
    .limit(1);

  if (alreadyRan && alreadyRan.length > 0) {
    return NextResponse.json(
      { skipped: true, reason: "Batch capture already ran today", date: todayStr },
      { status: 200 }
    );
  }

  // Marcar inicio del run
  // B-P0-2 fix (auditoría 2026-07-21, migración 207): dispatch_runs ahora
  // tiene UNIQUE(run_date, phase) real. El SELECT de arriba y este INSERT
  // no son atómicos entre sí, así que dos invocaciones concurrentes pueden
  // pasar ambas el guard antes de que cualquiera inserte. Con la restricción
  // UNIQUE, la segunda falla con 23505 en vez de duplicar la fila y
  // procesar el mismo lote dos veces -- se trata como "ya corrida" y se
  // sale sin capturar nada.
  const { data: runRow, error: runInsertError } = await supabase
    .from("dispatch_runs")
    .insert({
      run_date: todayStr,
      phase: "batch_capture",
      triggered_at: new Date().toISOString(),
      notes: "Batch capture 7PM Vancouver",
    })
    .select("id")
    .single();

  if (runInsertError) {
    if (runInsertError.code === "23505") {
      return NextResponse.json(
        {
          skipped: true,
          reason: "Batch capture already running (concurrent invocation)",
          date: todayStr,
        },
        { status: 200 }
      );
    }
    throw runInsertError;
  }
  const runId = runRow?.id;

  // Feature flags
  const [
    { data: chargebackFlag },
    { data: qboFlag },
    { data: cashReserveFlag },
    { data: disputeExclusionFlag },
    { data: partialCaptureFlag },
    { data: qcGateFlag },
  ] = await Promise.all([
    supabase.from("feature_flags").select("activo").eq("nombre", "chargeback_reserve_enabled").single(),
    supabase.from("feature_flags").select("activo").eq("nombre", "qbo_export_enabled").single(),
    supabase.from("feature_flags").select("activo").eq("nombre", "cash_reserve_tracking_enabled").single(),
    supabase
      .from("feature_flags")
      .select("activo")
      .eq("nombre", "batch_capture_dispute_exclusion_enabled")
      .single(),
    supabase
      .from("feature_flags")
      .select("activo")
      .eq("nombre", "batch_capture_partial_on_dispute_enabled")
      .single(),
    supabase
      .from("feature_flags")
      .select("activo")
      .eq("nombre", "batch_capture_qc_gate_enabled")
      .single(),
  ]);
  const chargebackEnabled = !!chargebackFlag?.activo;
  const qboEnabled = !!qboFlag?.activo;
  const cashReserveEnabled = !!cashReserveFlag?.activo;
  const disputeExclusionEnabled = !!disputeExclusionFlag?.activo;
  // v8.3 E5 (auditoría 2026-07-18): el muro QC nunca se consultaba desde
  // este cron. Apagado por defecto -- mismo patrón que los demás flags de
  // dinero de este módulo: se activa solo tras confirmar en staging que no
  // deja represada la caja de una operación pequeña donde QC pendiente es
  // la norma para empleados no-élite (migración 016 crea qc_reviews
  // 'pending' para todos los no-élite al completar el servicio).
  const qcGateEnabled = !!qcGateFlag?.activo;
  // v8.3 E2 (2026-07-13, decisión del dueño): cuando hay disputa crítica
  // documentada, en vez de no cobrar nada, cobrar de inmediato el costo
  // laboral+10% y el resto a 24h. Solo tiene efecto si disputeExclusionEnabled
  // también está prendido (ver migración 137).
  const partialCaptureOnDisputeEnabled = !!partialCaptureFlag?.activo;

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, quote_id, user_id, payment_option, stripe_hold_payment_intent_id, stripe_customer_id, stripe_payment_method_id, hold_amount, hold_authorized_amount, paypal_advance_amount, capture_attempts, capture_force_full_by, wallet_amount_used, quotes(total)"
      )
      .eq("service_date", todayStr)
      .eq("status", "completed")
      .not("status", "in", "(cancelled,no_show)")
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

      // v8.3 E2.10: Billetera Lulu -- si el cliente aplicó crédito de
      // billetera a esta orden (orders.wallet_amount_used, mismo formato en
      // DÓLARES que el resto de columnas monetarias de `orders` -- ya
      // descontado del saldo disponible al momento de aplicarlo, ver
      // /api/client/wallet/apply), se resta ANTES de calcular Hold/saldo. El
      // precio de la cotización sigue sellado (B.2.11): esto no muta
      // quotes.total, solo reduce lo que hay que cobrar por tarjeta/PayPal
      // para ESTA orden puntual.
      const quoteTotalBeforeWallet = Math.round(Number(order.quotes?.[0]?.total ?? 0));
      const walletAppliedDollars = Math.max(0, order.wallet_amount_used || 0);
      const quoteTotal = Math.max(0, quoteTotalBeforeWallet - walletAppliedDollars);
      if (quoteTotalBeforeWallet <= 0) {
        results.skipped++;
        results.errors.push({ orderId: order.id, error: "Missing quote total" });
        continue;
      }

      // v8.3 E2 (2026-07-13): un admin ya forzó el cobro completo pese a la
      // disputa (force-full-capture, fuera de este cron) -- no hay nada más
      // que hacer aquí, evita reprocesar/recobrar la misma orden.
      if (order.capture_force_full_by) {
        results.skipped++;
        results.errors.push({
          orderId: order.id,
          error: "SKIPPED: already force-captured by admin outside this run",
        });
        continue;
      }

      // v8.3 B.2.2 / B.2.18 / E2.3 (migración 080): el cobro es a las 7PM, FIJO.
      // La garantía es relacional a EVIDENCIA, no a reloj. Un reclamo abierto NO
      // congela el pago por defecto — SOLO excluye una disputa crítica (>=2
      // niveles) que además tenga evidencia fotográfica del cliente. Se evalúa
      // con una función pura testeable (evaluateCaptureEligibility).
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

      // v8.3 E5 (auditoría 2026-07-18): el muro QC nunca se consultaba desde
      // este cron -- se cobraba a las 7PM sin importar si qc_reviews seguía
      // 'pending' (empleado no-élite recién completado), 'rejected' o
      // 'rework' (servicio en corrección con timer de 30 min, migración
      // rework). Detrás de flag apagado por defecto (ver arriba) para poder
      // validar en staging antes de represar cobros reales.
      if (qcGateEnabled) {
        const { data: qcRow } = await supabase
          .from("qc_reviews")
          .select("status")
          .eq("order_id", order.id)
          .maybeSingle();

        const qcStatus = (qcRow?.status ?? null) as QcReviewStatus;
        const qcGate = evaluateQcGate(qcStatus);

        if (!qcGate.qcPasses) {
          results.skipped++;
          results.errors.push({
            orderId: order.id,
            error: `EXCLUDED: ${qcGate.reason} (qc_status=${qcStatus ?? "none"})`,
          });

          await supabase
            .from("orders")
            .update({
              capture_withheld_reason: qcGate.reason,
              capture_withheld_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "discrepancy",
            priority: "medium",
            status: "open",
            context: {
              reason: "batch_capture_withheld_qc_not_approved",
              qc_status: qcStatus,
              quote_total: quoteTotal,
            },
          });

          continue;
        }
      }

      if (!eligibility.shouldCapture) {
        // v8.3 E2 (2026-07-13): la captura parcial solo aplica a órdenes con
        // tarjeta. Una orden PayPal-primera-vez con disputa crítica en su
        // primerísimo servicio es un cruce de casos raro (anticipo PayPal ya
        // cobrado + captura parcial laboral) que no se resuelve aquí para no
        // arriesgar un doble cobro o un cálculo incorrecto sin poder
        // probarlo en vivo -- cae al camino de exclusión total existente.
        if (disputeExclusionEnabled && partialCaptureOnDisputeEnabled && order.payment_option === "card") {
          // En vez de no cobrar nada, cobrar de inmediato el costo laboral
          // (Σ payroll_entries) + 10%, y el resto a las 24h. Registra el
          // ticket igual que el camino de exclusión total, para que quede
          // en la bandeja de revisión -- lo único que cambia es que sí
          // entra dinero ahora.
          const { data: payrollRows, error: payrollError } = await supabase
            .from("payroll_entries")
            .select("gross_amount")
            .eq("order_id", order.id);

          if (payrollError) {
            console.error(`Payroll lookup failed for order ${order.id}:`, payrollError);
          }

          const laborCostCents =
            payrollRows && payrollRows.length > 0
              ? payrollRows.reduce((sum: number, r: { gross_amount: number }) => sum + (r.gross_amount || 0), 0)
              : null;

          const decision = computePartialCaptureDecision({
            quoteTotalCents: quoteTotal * 100,
            laborCostCents,
            forceFullCapture: false,
            now: new Date(),
          });

          await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "discrepancy",
            priority: "high",
            status: "open",
            context: {
              reason: "batch_capture_partial_critical_dispute",
              warranty_claim_id: eligibility.blockingClaimId,
              quote_total: quoteTotal,
              capture_now_cents: decision.captureNowCents,
              capture_remaining_cents: decision.remainingCents,
              decision_reason: decision.reason,
            },
          });

          try {
            const executed = await executePartialCapture(stripe, order, decision);

            await supabase
              .from("orders")
              .update({
                capture_withheld_reason: eligibility.reason,
                capture_withheld_at: new Date().toISOString(),
                capture_withheld_claim_id: eligibility.blockingClaimId,
                capture_partial_amount: Math.round(decision.captureNowCents / 100),
                capture_partial_at: new Date().toISOString(),
                capture_remaining_amount:
                  decision.remainingCents > 0 ? Math.round(decision.remainingCents / 100) : 0,
                capture_remaining_due_at: decision.remainingDueAt,
                stripe_hold_payment_intent_id: order.stripe_hold_payment_intent_id,
                total_paid: Math.round(decision.captureNowCents / 100) + walletAppliedDollars,
                card_amount_charged: Math.round(decision.captureNowCents / 100),
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);

            if (executed.capturedNowCents > 0) {
              await supabase.from("shadow_ledger_entries").insert(
                buildShadowLedgerEntry({
                  eventType: "balance_captured",
                  orderId: order.id,
                  userId: order.user_id,
                  amountCents: executed.capturedNowCents,
                  processor: "stripe",
                  externalReference: executed.paymentIntentId,
                  occurredAt: new Date(),
                  metadata: {
                    partial_capture: true,
                    reason: decision.reason,
                    blocking_claim_id: eligibility.blockingClaimId,
                  },
                })
              );
            }

            results.captured++;
          } catch (err: Error | unknown) {
            const message = err instanceof Error ? err.message : "Unknown partial capture error";
            results.failed++;
            results.errors.push({ orderId: order.id, error: `PARTIAL_CAPTURE_FAILED: ${message}` });

            await supabase.from("shadow_ledger_entries").insert(
              buildShadowLedgerEntry({
                eventType: "capture_failed",
                orderId: order.id,
                userId: order.user_id,
                amountCents: decision.captureNowCents,
                processor: "stripe",
                externalReference: null,
                occurredAt: new Date(),
                metadata: { partial_capture: true, error: message.slice(0, 300) },
              })
            );

            await supabase
              .from("orders")
              .update({
                capture_attempts: (order.capture_attempts ?? 0) + 1,
                capture_last_error: message.slice(0, 500),
                updated_at: new Date().toISOString(),
              })
              .eq("id", order.id);
          }

          continue;
        }

        if (disputeExclusionEnabled) {
          // Excluir de verdad: no cobrar, dejar en cola de revisión manual.
          results.skipped++;
          results.errors.push({
            orderId: order.id,
            error: `EXCLUDED: ${eligibility.reason} (claim ${eligibility.blockingClaimId})`,
          });

          await supabase
            .from("orders")
            .update({
              capture_withheld_reason: eligibility.reason,
              capture_withheld_at: new Date().toISOString(),
              capture_withheld_claim_id: eligibility.blockingClaimId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "discrepancy",
            priority: "high",
            status: "open",
            context: {
              reason: "batch_capture_withheld_critical_dispute",
              warranty_claim_id: eligibility.blockingClaimId,
              quote_total: quoteTotal,
            },
          });

          continue;
        }

        // Flag apagado: comportamiento histórico — se cobra igual, se deja
        // nota informativa. Permite activar la exclusión real solo tras
        // demo en staging + aprobación del dueño (criterios de aceptación E2).
        results.errors.push({
          orderId: order.id,
          error: `INFO: ${eligibility.reason} (claim ${eligibility.blockingClaimId}) — dispute_exclusion flag off, charged per legacy behavior`,
        });
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
              await stripe.paymentIntents.capture(
                order.stripe_hold_payment_intent_id,
                { amount_to_capture: Math.round(holdAmount * 100) },
                { idempotencyKey: `${order.id}:batch-capture-hold` }
              );
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
            // Fix RAÍZ-3 (auditoría 2026-07-21): `balanceAmount * 100` sobre
            // un número que puede traer resto de punto flotante (proviene de
            // quoteTotal - walletAppliedDollars, ambos derivados de columnas
            // dólares) producía valores como 32498.999999999996 -- Stripe
            // exige un entero de centavos y rechazaba la captura completa.
            // Math.round() al convertir a centavos, siempre.
            const balancePi = await stripe.paymentIntents.create(
              {
                amount: Math.round(balanceAmount * 100),
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
              },
              { idempotencyKey: `${order.id}:batch-capture-balance` }
            );
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
            const balancePi = await stripe.paymentIntents.create(
              {
                amount: Math.round(balanceAmount * 100),
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
              },
              { idempotencyKey: `${order.id}:batch-capture-paypal-balance` }
            );
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

        // v8.3 E2.5/C.2.4 (2026-07-13): Shadow Ledger -- registrar el cobro
        // real ANTES/en paralelo a QBO, independiente de si QBO responde.
        // Este módulo existía desde la migración 081 pero nada lo llamaba
        // todavía; aprovechando que este archivo se está tocando para la
        // captura parcial, se cierra ese hueco también en el camino normal.
        if (amountCharged > 0) {
          await supabase.from("shadow_ledger_entries").insert(
            buildShadowLedgerEntry({
              eventType: "balance_captured",
              orderId: order.id,
              userId: order.user_id,
              amountCents: amountCharged * 100,
              processor: "stripe",
              externalReference: payments.balance || payments.hold || null,
              occurredAt: new Date(),
              metadata: { payment_option: order.payment_option },
            })
          );
        }

        await supabase
          .from("orders")
          .update({
            hold_captured_at: payments.hold ? new Date().toISOString() : order.hold_captured_at,
            stripe_capture_payment_intent_id: payments.balance || null,
            capture_captured_at: payments.balance ? new Date().toISOString() : null,
            capture_authorized_amount: amountCharged,
            total_paid:
              amountCharged +
              walletAppliedDollars +
              (order.payment_option === "paypal_first_time" ? order.paypal_advance_amount : 0),
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

        // Reserva de impuestos 12% GST+PST (tracking virtual, v8.3 E2.9).
        // TODO: hoy no hay dato de propina/no-gravable separado a este
        // nivel; se trata el monto capturado como base gravable completa
        // hasta que el desglose de propina exista aguas arriba.
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

        // QBO export line (determinista). v8.3 E2 (migración 187) — upsert
        // por (order_id, transaction_type) para respetar el mismo índice
        // único que se agregó por el bug de duplicación en qbo-sync: si el
        // cron de batch-capture se reintenta sobre la misma orden, no debe
        // insertar una segunda línea "capture".
        if (qboEnabled && amountCharged > 0) {
          await supabase.from("qbo_export_lines").upsert(
            {
              export_id: null,
              order_id: order.id,
              payment_intent_id: payments.balance || payments.hold || null,
              transaction_type: "capture",
              transaction_date: new Date().toISOString(),
              gross_amount: amountCharged * 100,
              fee_amount: stripeFeeCents,
              net_amount: amountCharged * 100 - stripeFeeCents,
              description: `Capture order ${order.id}`,
            },
            { onConflict: "order_id,transaction_type" }
          );
        }

        results.captured++;
      } catch (err: Error | unknown) {
        results.failed++;
        const message = err instanceof Error ? err.message : "Unknown capture error";
        results.errors.push({ orderId: order.id, error: message });
        console.error(`Batch capture failed for order ${order.id}:`, err);

        await supabase.from("shadow_ledger_entries").insert(
          buildShadowLedgerEntry({
            eventType: "capture_failed",
            orderId: order.id,
            userId: order.user_id,
            amountCents: quoteTotal * 100,
            processor: "stripe",
            externalReference: null,
            occurredAt: new Date(),
            metadata: { error: message.slice(0, 300) },
          })
        );

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

/**
 * v8.3 E2 (2026-07-13) — ejecuta el "captureNowCents" de una decisión de
 * captura parcial contra Stripe, SOLO para órdenes con tarjeta (ver el
 * comentario de scope en el caller).
 *
 * LIMITACIÓN DE STRIPE (ver también batch-capture-partial.ts): un
 * PaymentIntent en `requires_capture` solo admite UNA captura. Si
 * `captureNowCents` es menor al Hold autorizado, capturar esa porción
 * LIBERA automáticamente el resto del Hold -- no queda una segunda captura
 * pendiente sobre el mismo PI. Por eso el remanente (si lo hay) se cobra
 * más tarde como un PaymentIntent NUEVO off-session (mismo mecanismo que ya
 * usa el "balance" del flujo normal), no como una segunda captura del Hold.
 */
async function executePartialCapture(
  stripe: Stripe,
  order: OrderRow,
  decision: { captureNowCents: number }
): Promise<{ capturedNowCents: number; paymentIntentId: string | null }> {
  if (decision.captureNowCents <= 0) {
    return { capturedNowCents: 0, paymentIntentId: null };
  }

  const holdAuthorizedCents = Math.round(
    Math.max(0, order.hold_authorized_amount || order.hold_amount || 0) * 100
  );

  const captureFromHoldCents = Math.min(decision.captureNowCents, holdAuthorizedCents);
  let capturedNowCents = 0;
  let lastPaymentIntentId: string | null = null;

  if (captureFromHoldCents > 0) {
    if (!order.stripe_hold_payment_intent_id) {
      throw new Error("Missing hold PaymentIntent for partial capture");
    }
    const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
    if (holdPi.status === "requires_capture") {
      await stripe.paymentIntents.capture(
        order.stripe_hold_payment_intent_id,
        { amount_to_capture: captureFromHoldCents },
        { idempotencyKey: `${order.id}:batch-capture-partial-hold` }
      );
    } else if (holdPi.status !== "succeeded") {
      throw new Error(`Hold PaymentIntent status: ${holdPi.status}`);
    }
    capturedNowCents += captureFromHoldCents;
    lastPaymentIntentId = order.stripe_hold_payment_intent_id;
  }

  const excessCents = decision.captureNowCents - captureFromHoldCents;
  if (excessCents > 0) {
    if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
      throw new Error("Missing customer or payment method for partial capture excess");
    }
    const excessPi = await stripe.paymentIntents.create(
      {
        amount: excessCents,
        currency: "cad",
        customer: order.stripe_customer_id,
        payment_method: order.stripe_payment_method_id,
        payment_method_types: ["card"],
        capture_method: "automatic",
        confirm: true,
        off_session: true,
        description: `Partial labor-safe capture for order ${order.id}`,
        metadata: {
          order_id: order.id,
          quote_id: order.quote_id,
          user_id: order.user_id,
          charge_type: "partial_capture_excess",
        },
      },
      { idempotencyKey: `${order.id}:batch-capture-partial-excess` }
    );
    if (excessPi.status !== "succeeded") {
      throw new Error(`Partial capture excess PaymentIntent status: ${excessPi.status}`);
    }
    capturedNowCents += excessCents;
    lastPaymentIntentId = excessPi.id;
  }

  return { capturedNowCents, paymentIntentId: lastPaymentIntentId };
}

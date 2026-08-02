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
import { safeErrorResponse } from "@/lib/api-errors";
import { requireCronAuth } from "@/lib/cron-auth";

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
  payment_option: "card" | "paypal_first_time" | "alipay" | "wechat_pay";
  stripe_hold_payment_intent_id: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  // RAÍZ-3 (2026-07-21, migración 229): estas 3 ahora están en CENTAVOS
  // enteros (antes dólares enteros). paypal_advance_amount NO se tocó en
  // esa migración -- sigue en dólares.
  hold_amount_cents: number;
  hold_authorized_amount_cents: number;
  hold_captured_at: string | null;
  paypal_advance_amount: number;
  capture_attempts: number;
  capture_force_full_by: string | null;
  wallet_amount_used_cents: number | null;
  // Fix (auditoría externa 2026-07-24): monto real cobrado por adelantado en
  // Alipay/WeChat Pay (distinto de wallet_amount_used_cents, que es crédito
  // de la billetera Lulu aplicado a órdenes con tarjeta). Necesario para no
  // perder ese cobro al recalcular total_paid_cents abajo -- ver nota junto
  // al UPDATE final.
  wallet_amount_collected_cents: number | null;
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
  const authError = requireCronAuth(request);
  if (authError) return authError;

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
        "id, quote_id, user_id, payment_option, stripe_hold_payment_intent_id, stripe_customer_id, stripe_payment_method_id, hold_amount_cents, hold_authorized_amount_cents, paypal_advance_amount, capture_attempts, capture_force_full_by, wallet_amount_used_cents, wallet_amount_collected_cents, quotes(total)"
      )
      .eq("service_date", todayStr)
      .eq("status", "completed")
      .not("status", "in", "(cancelled,no_show)")
      // Fix CRÍTICO (auditoría externa de integridad financiera, 2026-08-02):
      // esta query filtraba por `status` pero no excluía órdenes con soft
      // delete (deleted_at NOT NULL) -- operación puede haber dado por
      // eliminada una orden lógicamente sin cambiar su `status`, y este cron
      // igual la capturaba, cobrando dinero real sobre una orden que ya no
      // debía existir para el negocio.
      .is("deleted_at", null)
      .lt("capture_attempts", MAX_ATTEMPTS)
      .order("service_datetime", { ascending: true });

    if (error) {
      console.error("Batch capture fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
      // billetera a esta orden (orders.wallet_amount_used_cents -- RAÍZ-3,
      // migración 229: CENTAVOS, mismo formato que client_wallets/
      // wallet_transactions -- ya descontado del saldo disponible al momento
      // de aplicarlo, ver /api/client/wallet/apply), se resta ANTES de
      // calcular Hold/saldo. El precio de la cotización sigue sellado
      // (B.2.11): esto no muta quotes.total, solo reduce lo que hay que
      // cobrar por tarjeta/PayPal para ESTA orden puntual.
      //
      // RAÍZ-3: quotes.total sigue en DÓLARES (fuera de alcance de la
      // migración 229) -- todo el cálculo de esta función se hace en
      // CENTAVOS a partir de aquí, escalando quotes.total x100 una sola vez.
      const quoteTotalBeforeWalletCents = Math.round(Number(order.quotes?.[0]?.total ?? 0) * 100);
      const walletAppliedCents = Math.max(0, order.wallet_amount_used_cents || 0);
      const quoteTotalCents = Math.max(0, quoteTotalBeforeWalletCents - walletAppliedCents);
      if (quoteTotalBeforeWalletCents <= 0) {
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

          const { error: withholdError } = await supabase
            .from("orders")
            .update({
              capture_withheld_reason: qcGate.reason,
              capture_withheld_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          if (withholdError) {
            results.errors.push({
              orderId: order.id,
              error: `Failed to mark order as capture-withheld (QC gate): ${withholdError.message}`,
            });
          }

          const { error: ticketError } = await supabase.from("tickets_disputas").insert({
            order_id: order.id,
            type: "discrepancy",
            priority: "medium",
            status: "open",
            context: {
              reason: "batch_capture_withheld_qc_not_approved",
              qc_status: qcStatus,
              quote_total_cents: quoteTotalCents,
            },
          });

          if (ticketError) {
            results.errors.push({
              orderId: order.id,
              error: `Failed to create tickets_disputas ticket for QC-withheld capture: ${ticketError.message}`,
            });
          }

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
            quoteTotalCents,
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
              quote_total_cents: quoteTotalCents,
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
                // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents/
                // card_amount_charged_cents ya están en centavos -- se suma
                // decision.captureNowCents directo, sin dividir/redondear a
                // dólares (capture_remaining_amount SÍ sigue siendo una
                // columna fuera de alcance, en dólares, sin cambios arriba).
                total_paid_cents: decision.captureNowCents + walletAppliedCents,
                card_amount_charged_cents: decision.captureNowCents,
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
              quote_total_cents: quoteTotalCents,
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
        // RAÍZ-3 (2026-07-21, migración 229): amountChargedCents acumula en
        // CENTAVOS (antes "amountCharged" acumulaba dólares). captured_amount
        // (chargeback_reserves), gross_amount (qbo_export_lines) y
        // grossAmountCents (cash-reserve.ts) ya esperaban centavos --
        // aquí ya no hace falta *100 al pasarlos.
        let amountChargedCents = 0;
        const payments: { hold?: string; balance?: string } = {};

        if (order.payment_option === "card") {
          // Tarjeta: capturar Hold + cobrar saldo restante.
          const holdAmountCents = Math.min(
            Math.max(0, order.hold_authorized_amount_cents || order.hold_amount_cents || 0),
            quoteTotalCents
          );
          const balanceAmountCents = Math.max(0, quoteTotalCents - holdAmountCents);

          if (holdAmountCents > 0) {
            if (!order.stripe_hold_payment_intent_id) {
              throw new Error("Missing hold PaymentIntent for card order");
            }
            const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
            if (holdPi.status === "requires_capture") {
              await stripe.paymentIntents.capture(
                order.stripe_hold_payment_intent_id,
                { amount_to_capture: holdAmountCents },
                { idempotencyKey: `${order.id}:batch-capture-hold` }
              );
            } else if (holdPi.status !== "succeeded") {
              throw new Error(`Hold PaymentIntent status: ${holdPi.status}`);
            }
            payments.hold = order.stripe_hold_payment_intent_id;
            amountChargedCents += holdAmountCents;
          }

          if (balanceAmountCents > 0) {
            if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
              throw new Error("Missing customer or payment method for balance charge");
            }
            // Fix RAÍZ-3 (auditoría 2026-07-21): balanceAmountCents ya es un
            // entero de centavos (quoteTotalCents/holdAmountCents se derivan
            // con Math.round desde el origen) -- ya no hace falta el
            // Math.round(x*100) que existía cuando estas columnas eran
            // dólares con posible resto de punto flotante.
            const balancePi = await stripe.paymentIntents.create(
              {
                amount: balanceAmountCents,
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
            amountChargedCents += balanceAmountCents;
          }
        } else if (order.payment_option === "paypal_first_time") {
          // PayPal: el anticipo ya fue cobrado. paypal_advance_amount sigue
          // en DÓLARES (columna fuera de alcance de la migración 229) --
          // se escala x100 aquí para operar en centavos junto al resto.
          const paypalAdvanceCents = Math.min(
            Math.max(0, Math.round((order.paypal_advance_amount || order.hold_amount_cents * 0.5 / 100) * 100)),
            quoteTotalCents
          );
          const balanceAmountCents = Math.max(0, quoteTotalCents - paypalAdvanceCents);

          if (balanceAmountCents > 0) {
            if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
              throw new Error("Missing card registration for PayPal order balance charge");
            }
            const balancePi = await stripe.paymentIntents.create(
              {
                amount: balanceAmountCents,
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
                  paypal_advance_cents: paypalAdvanceCents,
                },
              },
              { idempotencyKey: `${order.id}:batch-capture-paypal-balance` }
            );
            if (balancePi.status !== "succeeded") {
              throw new Error(`PayPal balance PaymentIntent status: ${balancePi.status}`);
            }
            payments.balance = balancePi.id;
            amountChargedCents += balanceAmountCents;
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
        } else if (order.payment_option === "alipay" || order.payment_option === "wechat_pay") {
          // Alipay/WeChat Pay (feature 2026-07-21): el 100% ya se cobró por
          // adelantado vía un PaymentIntent real de Stripe al reservar --
          // nunca hay hold (hold-authorize/hold-preauth-check filtran
          // payment_option="card", así que estas órdenes nunca llegan a
          // tener uno) ni saldo pendiente que capturar.
          // amountChargedCents se queda en 0 intencionalmente: el cobro real
          // ya se registró como wallet_full_payment_received en
          // /api/stripe/confirm, no aquí.
        }

        // Stripe fee aproximada para QBO (2.9% + 0.30 CAD)
        const stripeFeeCents = Math.round(amountChargedCents * 0.029 + 30);

        // v8.3 E2.5/C.2.4 (2026-07-13): Shadow Ledger -- registrar el cobro
        // real ANTES/en paralelo a QBO, independiente de si QBO responde.
        // Este módulo existía desde la migración 081 pero nada lo llamaba
        // todavía; aprovechando que este archivo se está tocando para la
        // captura parcial, se cierra ese hueco también en el camino normal.
        if (amountChargedCents > 0) {
          await supabase.from("shadow_ledger_entries").insert(
            buildShadowLedgerEntry({
              eventType: "balance_captured",
              orderId: order.id,
              userId: order.user_id,
              amountCents: amountChargedCents,
              processor: "stripe",
              externalReference: payments.balance || payments.hold || null,
              occurredAt: new Date(),
              metadata: { payment_option: order.payment_option },
            })
          );
        }

        // Fix (auditoría externa 2026-07-31, hallazgo #3 -- CRÍTICO): antes
        // este bloque hacía un UPDATE plano que SOBREESCRIBÍA
        // total_paid_cents/card_amount_charged_cents/capture_authorized_amount
        // con un valor calculado en JS -- si el Hold ya había sido
        // reconciliado por reconcileCapturedPaymentIntent (ver
        // payment-capture-reconciliation.ts, que SÍ suma correctamente) o
        // por una ejecución previa de este mismo cron, ese monto se perdía
        // al recalcular "desde cero" en esta ejecución. Se reemplaza por la
        // RPC atómica apply_batch_capture_result (migración 296), que
        // INCREMENTA esas columnas en vez de sobreescribirlas.
        //
        // wallet_amount_collected_cents (Alipay/WeChat Pay) NO se incluye
        // aquí como delta: ya se escribió una sola vez en total_paid_cents
        // al crear la orden (stripe/confirm/route.ts) -- volver a sumarlo
        // en cada ejecución de este cron (ahora que es un incremento, no
        // una reescritura) lo duplicaría. Para esas órdenes amountChargedCents
        // ya es 0 (ver bloque de arriba), así que el delta de esta llamada
        // es 0 y total_paid_cents queda intacto, como corresponde.
        const paypalAdvanceDeltaCents =
          order.payment_option === "paypal_first_time"
            ? Math.round((order.paypal_advance_amount || 0) * 100)
            : 0;
        const { error: applyCaptureError } = await supabase.rpc("apply_batch_capture_result", {
          p_order_id: order.id,
          p_amount_captured_delta_cents: amountChargedCents,
          p_wallet_applied_delta_cents: walletAppliedCents,
          p_paypal_advance_delta_cents: paypalAdvanceDeltaCents,
          p_hold_payment_intent_id: payments.hold || null,
          p_balance_payment_intent_id: payments.balance || null,
        });
        if (applyCaptureError) {
          throw new Error(`apply_batch_capture_result failed: ${applyCaptureError.message}`);
        }

        // Chargeback reserve
        if (chargebackEnabled && amountChargedCents > 0) {
          const { data: settings } = await supabase
            .from("chargeback_settings")
            .select("reserve_percentage, reserve_cap_amount")
            .order("effective_from", { ascending: false })
            .limit(1)
            .single();

          const reservePercentage = settings?.reserve_percentage ? Number(settings.reserve_percentage) : 2.0;
          const reserveCap = settings?.reserve_cap_amount ? Number(settings.reserve_cap_amount) : null;
          let reserveAmount = Math.round(amountChargedCents * (reservePercentage / 100));
          if (reserveCap !== null && reserveCap > 0) {
            reserveAmount = Math.min(reserveAmount, reserveCap);
          }

          await supabase.from("chargeback_reserves").insert({
            order_id: order.id,
            payment_intent_id: payments.balance || payments.hold || null,
            captured_amount: amountChargedCents,
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
        if (cashReserveEnabled && amountChargedCents > 0) {
          const split = calculateReserveSplit({ grossAmountCents: amountChargedCents });
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
        if (qboEnabled && amountChargedCents > 0) {
          await supabase.from("qbo_export_lines").upsert(
            {
              export_id: null,
              order_id: order.id,
              payment_intent_id: payments.balance || payments.hold || null,
              transaction_type: "capture",
              transaction_date: new Date().toISOString(),
              gross_amount: amountChargedCents,
              fee_amount: stripeFeeCents,
              net_amount: amountChargedCents - stripeFeeCents,
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
            amountCents: quoteTotalCents,
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
    return safeErrorResponse(err);
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

  // RAÍZ-3 (2026-07-21, migración 229): hold_authorized_amount_cents/
  // hold_amount_cents ya están en centavos -- sin *100.
  const holdAuthorizedCents = Math.round(
    Math.max(0, order.hold_authorized_amount_cents || order.hold_amount_cents || 0)
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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { requireCronAuth } from "@/lib/cron-auth";

/**
 * POST /api/cron/installment-second-capture
 *
 * Cierra la limitación conocida y documentada en migración 152 / v8.3
 * E2.10 (src/lib/installment-payment.ts): el pago fraccionado 50/50
 * calculaba elegibilidad, desglose y `installment_second_due_at` desde el
 * checkout, pero ningún cron cobraba de verdad la segunda mitad. El flujo
 * Hold(T-72h)+Batch Capture(7PM) nunca se tocó — esto es un cron nuevo e
 * independiente que solo actúa sobre órdenes con
 * `installment_plan_selected = true`.
 *
 * Mismo patrón que /api/cron/capture-remainder (migración 137):
 *   - Feature flag apagado por defecto (installment_second_capture_cron_enabled,
 *     migración 245) — dry-run hasta que el dueño autorice el cobro real.
 *   - Idempotencia por FILA vía installment_second_captured_at IS NULL.
 *   - PaymentIntent off_session con idempotencyKey determinístico.
 *   - Shadow ledger en éxito y en fallo.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

interface InstallmentOrderRow {
  id: string;
  quote_id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  installment_second_amount_cents: number;
  installment_second_attempts: number;
}

const MAX_INSTALLMENT_SECOND_ATTEMPTS = 3;

export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: enabledFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "installment_second_capture_cron_enabled")
    .single();
  const cronEnabled = !!enabledFlag?.activo;

  const nowIso = new Date().toISOString();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, quote_id, user_id, stripe_customer_id, stripe_payment_method_id, installment_second_amount_cents, installment_second_attempts"
    )
    .eq("installment_plan_selected", true)
    .not("installment_second_due_at", "is", null)
    .lte("installment_second_due_at", nowIso)
    .is("installment_second_captured_at", null)
    .gt("installment_second_amount_cents", 0)
    .lt("installment_second_attempts", MAX_INSTALLMENT_SECOND_ATTEMPTS)
    // Mismo filtro que capture-remainder (fix A-4, auditoría 2026-07-21):
    // nunca cobrar remanentes de órdenes canceladas/no-show/borradas.
    .not("status", "in", "(cancelled,no_show)")
    .is("deleted_at", null)
    // Fix (auditoría externa, verificado 2026-07-31): la segunda mitad
    // nunca debe cobrarse antes de que la primera (el hold del flujo normal
    // Hold T-72h + Batch Capture) ya se haya capturado -- de lo contrario
    // se cobraría el 50% "de más" fuera de orden sin que el 50% base esté
    // asegurado. Se filtra aquí (ANTES de llamar a Stripe) y no solo en el
    // RPC de aplicación (capture_installment_second_atomic, migración 292)
    // para nunca cobrar la tarjeta si la condición no se cumple.
    .not("hold_captured_at", "is", null);

  if (error) {
    console.error("installment-second-capture fetch error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const candidates = (orders as unknown as InstallmentOrderRow[]) || [];

  if (!cronEnabled) {
    return NextResponse.json(
      {
        success: true,
        dryRun: true,
        reason: "installment_second_capture_cron_enabled flag is off — decisión pendiente del dueño",
        candidateOrders: candidates.length,
      },
      { status: 200 }
    );
  }

  const stripe = assertStripe();
  const results = {
    processed: 0,
    captured: 0,
    failed: 0,
    errors: [] as { orderId: string; error: string }[],
  };

  for (const order of candidates) {
    results.processed++;
    const secondCents = Math.round(order.installment_second_amount_cents || 0);

    if (secondCents <= 0) {
      continue;
    }

    try {
      if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
        throw new Error("Missing customer or payment method for installment second capture");
      }

      const pi = await stripe.paymentIntents.create(
        {
          amount: secondCents,
          currency: "cad",
          customer: order.stripe_customer_id,
          payment_method: order.stripe_payment_method_id,
          payment_method_types: ["card"],
          capture_method: "automatic",
          confirm: true,
          off_session: true,
          description: `Installment second payment for order ${order.id}`,
          metadata: {
            order_id: order.id,
            quote_id: order.quote_id,
            user_id: order.user_id,
            charge_type: "installment_second_payment",
          },
        },
        { idempotencyKey: `${order.id}:installment-second-capture` }
      );

      if (pi.status !== "succeeded") {
        throw new Error(`Installment second PaymentIntent status: ${pi.status}`);
      }

      await supabase.from("shadow_ledger_entries").insert(
        buildShadowLedgerEntry({
          eventType: "balance_captured",
          orderId: order.id,
          userId: order.user_id,
          amountCents: secondCents,
          processor: "stripe",
          externalReference: pi.id,
          occurredAt: new Date(),
          metadata: { installment_second_payment: true },
        })
      );

      // Fix (auditoría externa, verificado 2026-07-31): antes esto era un
      // SELECT (leer total_paid_cents) + suma en JS + UPDATE plano -- una
      // condición de carrera de doble conteo si esta función corriera dos
      // veces concurrentemente para la misma orden (ver migración 292 para
      // el detalle completo). Ahora es un UPDATE atómico de una sola
      // sentencia vía RPC (capture_installment_second_atomic, migración
      // 292), con el incremento calculado en SQL y el guard de idempotencia
      // (installment_second_captured_at IS NULL) en el mismo WHERE del
      // UPDATE -- también valida ahí mismo que hold_captured_at ya esté
      // seteado (la primera mitad ya cobrada) antes de aplicar la segunda.
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "capture_installment_second_atomic",
        {
          p_order_id: order.id,
          p_payment_intent_id: pi.id,
          p_amount_cents: secondCents,
        }
      );

      const applied = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

      if (rpcError || !applied?.success) {
        // El cobro en Stripe YA ocurrió (pi.status === "succeeded" arriba) --
        // esto es un fallo al REFLEJARLO localmente, no un fallo de cobro.
        // No reintentamos el cobro (sería un doble cobro real); se loguea
        // fuerte para reconciliación manual. El shadow ledger arriba ya
        // dejó evidencia del cobro real con idempotencyKey determinística.
        console.error(
          `CRITICAL: installment second capture succeeded in Stripe (PI ${pi.id}) but failed to reflect locally for order ${order.id}:`,
          rpcError || applied?.reason
        );
        results.failed++;
        results.errors.push({
          orderId: order.id,
          error: "Payment succeeded but local update failed",
        });
        continue;
      }

      results.captured++;
    } catch (err: Error | unknown) {
      results.failed++;
      const message = err instanceof Error ? err.message : "Unknown installment second capture error";
      results.errors.push({ orderId: order.id, error: "Installment second capture failed" });
      console.error(`Installment second capture failed for order ${order.id}:`, err);

      await supabase.from("shadow_ledger_entries").insert(
        buildShadowLedgerEntry({
          eventType: "capture_failed",
          orderId: order.id,
          userId: order.user_id,
          amountCents: secondCents,
          processor: "stripe",
          externalReference: null,
          occurredAt: new Date(),
          metadata: { installment_second_payment: true, error: message.slice(0, 300) },
        })
      );

      await supabase
        .from("orders")
        .update({
          installment_second_attempts: (order.installment_second_attempts ?? 0) + 1,
          installment_second_last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
    }
  }

  return NextResponse.json({ success: true, ...results }, { status: 200 });
}

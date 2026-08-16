import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { dollarsToCents } from "@/lib/currency";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { requireCronAuth } from "@/lib/cron-auth";

/**
 * POST /api/cron/capture-remainder
 *
 * v8.3 E2 (2026-07-13, decisión del dueño) — cobra el remanente diferido de
 * una captura parcial por disputa (ver batch-capture-partial.ts y la rama
 * de captura parcial en /api/cron/batch-capture). Corre cada hora (no una
 * vez al día como el batch de las 7PM): el vencimiento de cada orden es
 * dinámico (momento de la captura parcial + 24h), no un horario fijo.
 *
 * Idempotencia por FILA, no por día completo (a diferencia de batch-capture
 * / batch-capture-retry): la condición de la query
 * (capture_remaining_captured_at IS NULL) es la que evita reprocesar una
 * orden ya cobrada, así que no hace falta -- ni tendría sentido -- un guard
 * de "ya corrió hoy" para todo el job.
 *
 * Si en el ínterin un admin forzó el cobro completo (force-full-capture),
 * esa orden ya tiene capture_remaining_amount=0 / capture_remaining_captured_at
 * seteado por ese endpoint, así que esta query ya no la trae.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

interface RemainderOrderRow {
  id: string;
  quote_id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  capture_remaining_amount: number;
  capture_remaining_attempts: number;
}

const MAX_REMAINDER_ATTEMPTS = 3;

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
    .eq("nombre", "capture_remainder_cron_enabled")
    .single();
  const cronEnabled = !!enabledFlag?.activo;

  const nowIso = new Date().toISOString();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, quote_id, user_id, stripe_customer_id, stripe_payment_method_id, capture_remaining_amount, capture_remaining_attempts"
    )
    .not("capture_remaining_due_at", "is", null)
    .lte("capture_remaining_due_at", nowIso)
    .is("capture_remaining_captured_at", null)
    .gt("capture_remaining_amount", 0)
    .lt("capture_remaining_attempts", MAX_REMAINDER_ATTEMPTS)
    // Fix A-4 (auditoría 2026-07-21): este era el único cron de dinero sin
    // filtro de estado ni de borrado lógico -- cobraba el remanente de
    // órdenes ya canceladas/no_show dentro de la ventana de 24h. Mismo
    // filtro que usan los demás crons de captura.
    .not("status", "in", "(cancelled,no_show)")
    .is("deleted_at", null);

  if (error) {
    console.error("capture-remainder fetch error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const candidates = (orders as unknown as RemainderOrderRow[]) || [];

  if (!cronEnabled) {
    return NextResponse.json(
      {
        success: true,
        dryRun: true,
        reason: "capture_remainder_cron_enabled flag is off — decisión pendiente del dueño",
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
    const remainingCents = dollarsToCents(order.capture_remaining_amount || 0);

    if (remainingCents <= 0) {
      continue;
    }

    try {
      if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
        throw new Error("Missing customer or payment method for remainder capture");
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
          description: `Deferred remainder (24h) for order ${order.id}`,
          metadata: {
            order_id: order.id,
            quote_id: order.quote_id,
            user_id: order.user_id,
            charge_type: "partial_capture_remainder",
          },
        },
        { idempotencyKey: `${order.id}:capture-remainder` }
      );

      if (pi.status !== "succeeded") {
        throw new Error(`Remainder PaymentIntent status: ${pi.status}`);
      }

      await supabase.from("shadow_ledger_entries").insert(
        buildShadowLedgerEntry({
          eventType: "balance_captured",
          orderId: order.id,
          userId: order.user_id,
          amountCents: remainingCents,
          processor: "stripe",
          externalReference: pi.id,
          occurredAt: new Date(),
          metadata: { partial_capture_remainder: true },
        })
      );

      // Fix (auditoría externa, verificado 2026-07-31): antes esto era un
      // SELECT (leer total_paid_cents) + suma en JS + UPDATE plano -- misma
      // condición de carrera de doble conteo que en installment-second-capture
      // (ver migración 292). Ahora es un UPDATE atómico de una sola
      // sentencia vía RPC (capture_remainder_atomic), con el incremento
      // calculado en SQL y el guard de idempotencia
      // (capture_remaining_captured_at IS NULL) en el mismo WHERE del UPDATE.
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "capture_remainder_atomic",
        {
          p_order_id: order.id,
          p_payment_intent_id: pi.id,
          p_amount_cents: remainingCents,
        }
      );

      const applied = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

      if (rpcError || !applied?.success) {
        // El cobro en Stripe YA ocurrió -- fallo al reflejarlo localmente,
        // no un fallo de cobro. No reintentamos (evita doble cobro real).
        console.error(
          `CRITICAL: remainder capture succeeded in Stripe (PI ${pi.id}) but failed to reflect locally for order ${order.id}:`,
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
      const message = err instanceof Error ? err.message : "Unknown remainder capture error";
      results.errors.push({ orderId: order.id, error: "Remainder capture failed" });
      console.error(`Remainder capture failed for order ${order.id}:`, err);

      await supabase.from("shadow_ledger_entries").insert(
        buildShadowLedgerEntry({
          eventType: "capture_failed",
          orderId: order.id,
          userId: order.user_id,
          amountCents: remainingCents,
          processor: "stripe",
          externalReference: null,
          occurredAt: new Date(),
          metadata: { partial_capture_remainder: true, error: message.slice(0, 300) },
        })
      );

      await supabase
        .from("orders")
        .update({
          capture_remaining_attempts: (order.capture_remaining_attempts ?? 0) + 1,
          capture_remaining_last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
    }
  }

  return NextResponse.json({ success: true, ...results }, { status: 200 });
}

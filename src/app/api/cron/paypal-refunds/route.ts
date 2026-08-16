import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refundPayPalCapture } from "@/lib/paypal";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { requireCronAuth } from "@/lib/cron-auth";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { safeErrorResponse } from "@/lib/api-errors";
import { dollarsToCents } from "@/lib/currency";

/**
 * POST /api/cron/paypal-refunds
 *
 * Job programado cada 4 horas (relajado de hourly en la auditoría m-2
 * 2026-07-20b: la obligación es procesar el reembolso dentro de la ventana
 * de >72h, así que una cadencia de 4h no compromete el plazo real y reduce
 * la cuenta de invocaciones sub-diarias que exigen Vercel Pro). Procesa
 * órdenes canceladas con reembolso PayPal pendiente.
 * v8.2: el reembolso completo >72h es obligatorio para la opción PayPal primer servicio.
 *
 * Nota: la ejecución real requiere integración con la API de PayPal (clientId/secret).
 *       Este cron expone el pipeline: marca órdenes, loguea y deja un hook para la
 *       integración real.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, user_id, paypal_transaction_id, paypal_advance_amount, paypal_refund_status")
      .eq("status", "cancelled")
      .eq("paypal_refund_required", true)
      .in("paypal_refund_status", ["pending", "failed"])
      .order("updated_at", { ascending: true })
      .limit(50);

    if (error) {
      console.error("PayPal refunds fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const results: { orderId: string; status: string; error?: string }[] = [];

    for (const order of orders || []) {
      if (!order.paypal_transaction_id || !order.paypal_advance_amount) {
        results.push({ orderId: order.id, status: "failed", error: "Missing PayPal transaction data" });
        continue;
      }

      // Fix B-P2-3 (auditoría 2026-07-21): antes esto era un TODO permanente
      // — nunca reembolsaba nada, solo console.log, y reescribía "failed" a
      // "pending" en cada corrida borrando la evidencia del fallo anterior.
      // Ahora llama de verdad a la API de reembolsos de PayPal
      // (src/lib/paypal.ts::refundPayPalCapture) y, si falla, deja el estado
      // en "failed" (no "pending") + una alerta unificada para que un humano
      // se entere, en vez de fallar en silencio para siempre.
      // originId = order.id (fix MEDIO, auditoría 2026-08-02, ver
      // src/lib/paypal.ts): hace la idempotency key única por orden, no solo
      // por captureId+amount, para que dos reembolsos legítimos distintos
      // del mismo monto sobre la misma captura de PayPal no colisionen.
      const refundResult = await refundPayPalCapture(
        order.paypal_transaction_id,
        Number(order.paypal_advance_amount),
        "Reembolso por cancelación de servicio Lulu Island",
        order.id
      );

      if (refundResult.success) {
        await supabase
          .from("orders")
          .update({
            paypal_refund_status: "refunded",
            paypal_refund_id: refundResult.refundId ?? null,
            paypal_refund_notes: `Refunded $${order.paypal_advance_amount} — PayPal refund ${refundResult.refundId ?? "n/a"} (${refundResult.status ?? "unknown"})`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        // Fix Kimi-A13/M10 (auditoría externa Kimi Code, 2026-07-21,
        // verificado y confirmado real -- y más grave de lo reportado):
        // buildShadowLedgerEntry() LANZA una excepción si amountCents < 0
        // (por diseño -- la magnitud siempre es >= 0, la dirección la da
        // event_type, ver src/lib/shadow-ledger.ts). Este código pasaba un
        // monto NEGATIVO. Como todo el for-loop de este cron está dentro de
        // un único try/catch (no por-iteración), la excepción no solo
        // impedía este registro contable -- abortaba el procesamiento de
        // TODAS las órdenes restantes del batch (hasta 50) en cada corrida,
        // después de que el reembolso real en PayPal ya se había emitido
        // para la orden que disparó el throw.
        await supabase.from("shadow_ledger_entries").insert(
          buildShadowLedgerEntry({
            eventType: "warranty_refund",
            orderId: order.id,
            userId: order.user_id,
            amountCents: dollarsToCents(Number(order.paypal_advance_amount)),
            processor: "paypal",
            externalReference: refundResult.refundId ?? order.paypal_transaction_id,
            occurredAt: new Date(),
            metadata: { source: "cron_paypal_refunds" },
          })
        );

        results.push({ orderId: order.id, status: "refunded" });
      } else {
        await supabase
          .from("orders")
          .update({
            paypal_refund_status: "failed",
            paypal_refund_notes: `Refund attempt failed: ${refundResult.error}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);

        await publishUnifiedAlert(supabase, {
          sourceModule: "paypal_refunds_cron",
          sourceTable: "orders",
          sourceId: order.id,
          tier: "respond_10min",
          severity: "p1_urgent",
          title: "PayPal refund failed — requires manual intervention",
          summary: `Order ${order.id}: refund of $${order.paypal_advance_amount} for PayPal tx ${order.paypal_transaction_id} failed: ${refundResult.error}`,
        });

        results.push({ orderId: order.id, status: "failed", error: refundResult.error });
      }
    }

    return NextResponse.json(
      {
        processed: results.length,
        results,
        note: "PayPal API integration required to complete refunds automatically.",
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

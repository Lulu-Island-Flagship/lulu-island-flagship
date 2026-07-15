import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/cron/paypal-refunds
 *
 * Job programado cada hora. Procesa órdenes canceladas con reembolso PayPal pendiente.
 * v8.2: el reembolso completo >72h es obligatorio para la opción PayPal primer servicio.
 *
 * Nota: la ejecución real requiere integración con la API de PayPal (clientId/secret).
 *       Este cron expone el pipeline: marca órdenes, loguea y deja un hook para la
 *       integración real.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: { orderId: string; status: string; error?: string }[] = [];

    for (const order of orders || []) {
      if (!order.paypal_transaction_id || !order.paypal_advance_amount) {
        results.push({ orderId: order.id, status: "failed", error: "Missing PayPal transaction data" });
        continue;
      }

      // TODO: integrar POST /v2/payments/captures/{captureId}/refund con PayPal SDK.
      // Mientras tanto, marcamos como pending y registramos el intento para revisión manual.
      console.log(
        `[paypal-refund] Order ${order.id}: refund $${order.paypal_advance_amount} for tx ${order.paypal_transaction_id}`
      );

      await supabase
        .from("orders")
        .update({
          paypal_refund_status: "pending",
          paypal_refund_notes: `Refund of $${order.paypal_advance_amount} pending PayPal API integration`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);

      results.push({ orderId: order.id, status: "pending" });
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
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PayPal refunds cron error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

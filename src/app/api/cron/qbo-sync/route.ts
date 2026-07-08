import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/cron/qbo-sync
 *
 * Job programado a las 2:00 AM hora Vancouver.
 * Prepara las órdenes pagadas de las últimas 24h para exportación a QBO.
 * v8.2: el sync es determinista; los webhooks solo optimizan.
 *
 * Nota: la integración real con QuickBooks Online requiere OAuth2 y credenciales.
 *       Este cron marca órdenes pendientes y genera líneas de exportación con
 *       desglose GST/PST. La llamada a la API de QBO es TODO.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

export async function POST(request: NextRequest) {
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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabase
      .from("orders")
      .select("id, user_id, total_paid, card_amount_charged, gst, pst, subtotal, total_paid")
      .eq("qbo_export_status", "pending")
      .gte("capture_captured_at", since)
      .order("capture_captured_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("QBO sync fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: { orderId: string; status: string; error?: string }[] = [];

    for (const order of orders || []) {
      const gross = Math.round((order.total_paid || 0) * 100);
      const gst = Math.round(((order as { gst?: number }).gst || 0) * 100);
      const pst = Math.round(((order as { pst?: number }).pst || 0) * 100);
      const fee = Math.round(gross * 0.029 + 30);
      const net = gross - fee;

      const { error: lineError } = await supabase.from("qbo_export_lines").insert({
        order_id: order.id,
        export_id: null,
        payment_intent_id: null,
        transaction_type: "sales_receipt",
        transaction_date: new Date().toISOString(),
        gross_amount: gross,
        fee_amount: fee,
        net_amount: net,
        gst_amount: gst,
        pst_amount: pst,
        description: `Sales receipt order ${order.id}`,
      });

      if (lineError) {
        console.error("QBO export line insert error:", lineError);
        results.push({ orderId: order.id, status: "failed", error: lineError.message });
        continue;
      }

      await supabase
        .from("orders")
        .update({ qbo_export_status: "exported", updated_at: new Date().toISOString() })
        .eq("id", order.id);

      results.push({ orderId: order.id, status: "exported" });
    }

    return NextResponse.json(
      {
        processed: results.length,
        results,
        note: "QBO API integration required to push Sales Receipts to QuickBooks Online.",
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("QBO sync cron error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

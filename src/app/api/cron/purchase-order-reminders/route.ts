import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { evaluatePendingPurchaseOrders, type PendingPurchaseOrder } from "@/lib/purchase-order-escalation";
import { captureError } from "@/lib/observability";

/**
 * POST /api/cron/purchase-order-reminders
 *
 * v8.3 E7 (D.7.6, punto 6) — recordatorio 48h + alerta stock-out 72h de
 * órdenes de compra. Las columnas `reminder_sent_at`/`stockout_alert_sent_at`
 * existen en `purchase_orders` desde la migración 048 pero nunca se
 * poblaban: no había cron. Este job corre cada hora y es el único que
 * ESCRIBE esas dos columnas.
 *
 * No hay proveedor de SMS/email configurado en este entorno (mismo caso que
 * el resto del sistema — ver adaptadores "not_configured"), así que "enviar"
 * aquí significa: marcar la columna correspondiente (auditable, visible en
 * /admin/purchase-orders) y dejar log en consola. Si se conecta un
 * proveedor real más adelante, este cron es el único punto a tocar.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}.
 */
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
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: pending, error: fetchError } = await supabase
      .from("purchase_orders")
      .select("id, status, created_at, reminder_sent_at, stockout_alert_sent_at")
      .eq("status", "pending_approval")
      .is("deleted_at", null);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const inputs: PendingPurchaseOrder[] = (pending || []).map((po) => ({
      id: po.id,
      status: po.status,
      createdAt: po.created_at,
      reminderSentAt: po.reminder_sent_at,
      stockoutAlertSentAt: po.stockout_alert_sent_at,
    }));

    const decisions = evaluatePendingPurchaseOrders(inputs, nowIso);

    let remindersSent = 0;
    let stockoutAlertsSent = 0;

    for (const decision of decisions) {
      const update: Record<string, string> = {};
      if (decision.shouldSendReminder) {
        update.reminder_sent_at = nowIso;
        remindersSent += 1;
      }
      if (decision.shouldSendStockoutAlert) {
        update.stockout_alert_sent_at = nowIso;
        stockoutAlertsSent += 1;
      }
      if (Object.keys(update).length > 0) {
        await supabase.from("purchase_orders").update(update).eq("id", decision.id);
        console.log(
          `[purchase-order-reminders] PO ${decision.id}: ${Math.floor(decision.hoursSinceCreated)}h pendiente — ` +
            `${decision.shouldSendReminder ? "reminder " : ""}${decision.shouldSendStockoutAlert ? "stockout_alert" : ""}`
        );
      }
    }

    return NextResponse.json(
      {
        evaluated: inputs.length,
        remindersSent,
        stockoutAlertsSent,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    captureError(err, { route: "cron/purchase-order-reminders" });
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

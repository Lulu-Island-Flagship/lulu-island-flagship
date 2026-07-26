import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/orders/[id]/communication-log — v8.3 E6.3: "Timeline de
 * comunicación por orden: vista cronológica unificada (canal, hora,
 * entregado/leído/respondido), referenciada por tickets y disputas."
 *
 * `communication_log` (migración 045) ya tenía `order_id` indexado desde
 * que se creó — el dato estaba listo, solo faltaba esta ruta + la UI que la
 * consume (nunca se construyó ninguna).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;

  const { data, error } = await auth.supabase
    .from("communication_log")
    .select("id, event_key, category, channel, language, body_rendered, status, postponed_reason, scheduled_for, sent_at, created_at")
    .eq("order_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("admin/orders/[id]/communication-log error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ communicationLog: data || [] }, { status: 200 });
}

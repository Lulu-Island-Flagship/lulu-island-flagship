import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/checklist?orderId=... — detalle de checklist por servicio (acceso supervisor)
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("checklists_sop", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    // Obtener la orden para saber el service_subtype
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("quote_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Obtener el quote para saber el service_type
    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("service_type")
      .eq("id", order.quote_id)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const serviceSubtype = quote.service_type === "deep" ? "first_time" : quote.service_type;

    // Obtener plantilla de checklist
    const { data: checklists, error: checklistError } = await supabase
      .from("sop_checklists")
      .select("*")
      .is("deleted_at", null)
      .eq("service_subtype", serviceSubtype)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (checklistError) {
      return NextResponse.json({ error: checklistError.message }, { status: 500 });
    }

    // Obtener respuestas guardadas
    const { data: responses, error: respError } = await supabase
      .from("service_checklist_items")
      .select("*")
      .eq("order_id", orderId);

    if (respError) {
      return NextResponse.json({ error: respError.message }, { status: 500 });
    }

    const responseMap = new Map();
    for (const r of responses || []) {
      responseMap.set(r.item_id, r);
    }

    // Combinar plantilla + respuestas
    const zones = (checklists || []).map((cl) => {
      const items = (cl.items || []).map((item: { id: string; label: string; required: boolean }) => {
        const resp = responseMap.get(item.id);
        return {
          itemId: item.id,
          label: item.label,
          required: item.required,
          isCompleted: resp?.is_completed || false,
          completedAt: resp?.completed_at || null,
          photoUrl: resp?.photo_url || undefined,
          notes: resp?.notes || undefined,
          employeeId: resp?.employee_id || undefined,
        };
      });

      const totalItems = items.length;
      const completedItems = items.filter((i: { isCompleted: boolean }) => i.isCompleted).length;
      const requiredItems = items.filter((i: { required: boolean }) => i.required).length;
      const requiredCompleted = items.filter((i: { required: boolean; isCompleted: boolean }) => i.required && i.isCompleted).length;

      return {
        checklistId: cl.id,
        zone: cl.zone,
        zoneLabel: cl.zone_label,
        zoneColor: cl.zone_color,
        zoneIcon: cl.zone_icon,
        totalItems,
        completedItems,
        requiredItems,
        requiredCompleted,
        items,
      };
    });

    const totalItems = zones.reduce((sum, z) => sum + z.totalItems, 0);
    const completedItems = zones.reduce((sum, z) => sum + z.completedItems, 0);
    const requiredItems = zones.reduce((sum, z) => sum + z.requiredItems, 0);
    const requiredCompleted = zones.reduce((sum, z) => sum + z.requiredCompleted, 0);

    return NextResponse.json({
      zones,
      progress: {
        totalItems,
        completedItems,
        requiredItems,
        requiredCompleted,
        percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
        percentRequired: requiredItems > 0 ? Math.round((requiredCompleted / requiredItems) * 100) : 100,
      },
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin checklist error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

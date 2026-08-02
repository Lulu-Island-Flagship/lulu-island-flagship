import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import {
  computeReorderSuggestions,
  computeConsumptionProjections,
  formatConsumptionAlert,
  type InventoryItemStock,
  type InventoryItemWithConsumption,
  type UpcomingServiceCount,
} from "@/lib/inventory-reorder";

// Ventana de proyección de consumo: "esta semana" (spec D.7.6).
const CONSUMPTION_WINDOW_DAYS = 7;

// GET /api/admin/inventory-items — listar productos + sugerencias de reposicion
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("inventory_items")
    .select("id, name, category, unit, current_stock, reorder_threshold, consumption_per_service, is_active")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("admin/inventory-items error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const stockItems: InventoryItemStock[] = (data || []).map((i) => ({
    id: i.id,
    name: i.name,
    currentStock: Number(i.current_stock),
    reorderThreshold: Number(i.reorder_threshold),
  }));
  const reorderSuggestions = computeReorderSuggestions(stockItems);

  // v8.3 E7 fix de auditoría: además del umbral fijo, proyecta el consumo
  // real de los servicios YA agendados en los próximos 7 días usando
  // consumption_per_service (migración 048), que antes nunca se leía.
  const windowStart = new Date();
  const windowEnd = new Date(windowStart.getTime() + CONSUMPTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

  const { data: upcomingOrders, error: ordersError } = await supabase
    .from("orders")
    .select("quotes(service_type)")
    .gte("service_date", toDateStr(windowStart))
    .lte("service_date", toDateStr(windowEnd))
    .not("status", "in", "(cancelled,no_show)");

  let consumptionAlerts: string[] = [];
  if (!ordersError) {
    type QuoteJoin = { service_type: string } | { service_type: string }[] | null;
    const serviceCounts = new Map<string, number>();
    for (const row of upcomingOrders || []) {
      const quoteJoin = (row as { quotes: QuoteJoin }).quotes;
      const quote = Array.isArray(quoteJoin) ? quoteJoin[0] : quoteJoin;
      const serviceType = quote?.service_type;
      if (!serviceType) continue;
      serviceCounts.set(serviceType, (serviceCounts.get(serviceType) || 0) + 1);
    }
    const upcomingServices: UpcomingServiceCount[] = Array.from(serviceCounts.entries()).map(
      ([serviceType, count]) => ({ serviceType, count })
    );

    const itemsWithConsumption: InventoryItemWithConsumption[] = (data || []).map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      currentStock: Number(i.current_stock),
      reorderThreshold: Number(i.reorder_threshold),
      consumptionPerService: (i.consumption_per_service as Record<string, number>) || {},
    }));

    const projections = computeConsumptionProjections(itemsWithConsumption, upcomingServices);
    consumptionAlerts = projections.map(formatConsumptionAlert);
  }

  return NextResponse.json(
    { items: data || [], reorderSuggestions, consumptionAlerts },
    { status: 200 }
  );
}

// POST /api/admin/inventory-items — crear producto
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, category, unit, currentStock, reorderThreshold, consumptionPerService } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "name es requerido" }, { status: 400 });
    }

    // Fix (auditoría externa 2026-07-31, item 15): el cliente ya clampa a
    // Math.max(0, ...), pero eso no protege nada si alguien llama al
    // endpoint directamente -- se valida también en el servidor.
    if (currentStock !== undefined && (typeof currentStock !== "number" || currentStock < 0)) {
      return NextResponse.json({ error: "currentStock no puede ser negativo" }, { status: 400 });
    }
    if (reorderThreshold !== undefined && (typeof reorderThreshold !== "number" || reorderThreshold < 0)) {
      return NextResponse.json({ error: "reorderThreshold no puede ser negativo" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("inventory_items")
      .insert({
        name: name.trim(),
        category: category || "other",
        unit: unit || "unit",
        current_stock: currentStock ?? 0,
        reorder_threshold: reorderThreshold ?? 0,
        consumption_per_service: consumptionPerService || {},
      })
      .select()
      .single();

    if (error) {
      console.error("admin/inventory-items error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

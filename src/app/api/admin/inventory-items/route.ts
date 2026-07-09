import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeReorderSuggestions, type InventoryItemStock } from "@/lib/inventory-reorder";

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const stockItems: InventoryItemStock[] = (data || []).map((i) => ({
    id: i.id,
    name: i.name,
    currentStock: Number(i.current_stock),
    reorderThreshold: Number(i.reorder_threshold),
  }));
  const reorderSuggestions = computeReorderSuggestions(stockItems);

  return NextResponse.json({ items: data || [], reorderSuggestions }, { status: 200 });
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

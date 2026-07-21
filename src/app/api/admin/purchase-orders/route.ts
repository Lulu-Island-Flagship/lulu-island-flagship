import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeReorderSuggestions, formatReorderReason, type InventoryItemStock } from "@/lib/inventory-reorder";

// GET /api/admin/purchase-orders — listar POs con sus lineas
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
    .from("purchase_orders")
    .select(`
      id, status, generated_reason, approved_at, ordered_at, received_at, created_at,
      purchase_order_lines ( id, inventory_item_id, quantity, unit_price_cents )
    `)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ purchaseOrders: data || [] }, { status: 200 });
}

// POST /api/admin/purchase-orders — generar PO(s) automaticamente a partir de
// los items bajo el umbral de reposicion. v8.3 D.7.6: "stock < umbral -> PO
// generada -> aprobacion de un toque". Esta accion CREA la PO en estado
// pending_approval; NO la aprueba (eso es un paso humano separado, ver
// /approve). Si ya existe una PO pending_approval abierta, no duplica.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;
  if (!supabase || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Ya hay una PO pendiente de aprobacion abierta: no generar otra (evita
    // duplicados si el admin le da clic dos veces).
    const { data: existingPending } = await supabase
      .from("purchase_orders")
      .select("id")
      .eq("status", "pending_approval")
      .is("deleted_at", null)
      .limit(1);

    if (existingPending && existingPending.length > 0) {
      return NextResponse.json(
        { error: "Ya existe una orden de compra pendiente de aprobación.", existingId: existingPending[0].id },
        { status: 409 }
      );
    }

    const { data: items, error: itemsError } = await supabase
      .from("inventory_items")
      .select("id, name, current_stock, reorder_threshold")
      .is("deleted_at", null)
      .eq("is_active", true);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    const stockItems: InventoryItemStock[] = (items || []).map((i) => ({
      id: i.id,
      name: i.name,
      currentStock: Number(i.current_stock),
      reorderThreshold: Number(i.reorder_threshold),
    }));
    const suggestions = computeReorderSuggestions(stockItems);

    if (suggestions.length === 0) {
      return NextResponse.json({ error: "Ningún producto está bajo el umbral de reposición ahora mismo." }, { status: 400 });
    }

    const reason = suggestions.map(formatReorderReason).join(" ");

    // v8.3 E7 punto 6: el costo de la PO se lee del precio vigente
    // (is_current = true) del catálogo de proveedores, no de un valor fijo.
    // Si un producto tiene varios proveedores vigentes, se toma el más
    // barato; si no tiene ninguno cargado todavía, la línea queda sin precio
    // (unit_price_cents = null) — el admin lo completa a mano hasta que
    // cargue el catálogo real.
    const itemIds = suggestions.map((s) => s.itemId);
    const { data: catalogRows, error: catalogError } = await supabase
      .from("supplier_catalog")
      .select("supplier_id, inventory_item_id, unit_price_cents")
      .in("inventory_item_id", itemIds)
      .eq("is_current", true);

    if (catalogError) {
      return NextResponse.json({ error: catalogError.message }, { status: 500 });
    }

    const cheapestBySupplierPerItem = new Map<string, { supplierId: string; unitPriceCents: number }>();
    for (const row of catalogRows || []) {
      const current = cheapestBySupplierPerItem.get(row.inventory_item_id);
      if (!current || row.unit_price_cents < current.unitPriceCents) {
        cheapestBySupplierPerItem.set(row.inventory_item_id, {
          supplierId: row.supplier_id,
          unitPriceCents: row.unit_price_cents,
        });
      }
    }

    // Si todas las líneas resuelven al mismo proveedor vigente, se asigna a
    // la PO (sigue siendo humano cambiarlo después si hace falta).
    const resolvedSupplierIds = new Set(
      Array.from(cheapestBySupplierPerItem.values()).map((v) => v.supplierId)
    );
    const singleSupplierId =
      resolvedSupplierIds.size === 1 ? Array.from(resolvedSupplierIds)[0] : null;

    // C-H6 (auditoría 2026-07-21): registra quién creó la PO -- sin esto no
    // había forma de detectar después que la misma persona la creó y la
    // aprobó (ver bloqueo de autoaprobación en [id]/approve/route.ts).
    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .insert({
        status: "pending_approval",
        generated_reason: reason,
        supplier_id: singleSupplierId,
        created_by: user.id,
      })
      .select()
      .single();

    if (poError) {
      return NextResponse.json({ error: poError.message }, { status: 500 });
    }

    const lines = suggestions.map((s) => {
      const priced = cheapestBySupplierPerItem.get(s.itemId);
      return {
        purchase_order_id: po.id,
        inventory_item_id: s.itemId,
        quantity: s.deficit,
        unit_price_cents: priced?.unitPriceCents ?? null,
      };
    });

    const { error: linesError } = await supabase.from("purchase_order_lines").insert(lines);
    if (linesError) {
      return NextResponse.json({ error: linesError.message }, { status: 500 });
    }

    const estimatedTotalCents = lines.reduce(
      (sum, l) => sum + (l.unit_price_cents ?? 0) * (suggestions.find((s) => s.itemId === l.inventory_item_id)?.deficit ?? 0),
      0
    );

    return NextResponse.json(
      { purchaseOrder: po, suggestions, estimatedTotalCents },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

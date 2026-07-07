import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// PUT /api/admin/checklists/[id] — editar zona existente
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { zone_label, zone_color, zone_icon, items, sort_order, is_active } = body;

    // Para items: preservar IDs existentes, generar nuevos solo para items nuevos
    // Items "eliminados" se marcan con active: false, no se quitan del array
    const processedItems = items?.map((item: { id?: string; label: string; required: boolean; active?: boolean }) => ({
      id: item.id || `${body.zone || 'item'}_${Math.random().toString(36).substring(2, 9)}`,
      label: item.label,
      required: item.required ?? false,
      active: item.active !== false, // default true unless explicitly false
    }));

    const updateData: Record<string, unknown> = {};
    if (zone_label !== undefined) updateData.zone_label = zone_label;
    if (zone_color !== undefined) updateData.zone_color = zone_color;
    if (zone_icon !== undefined) updateData.zone_icon = zone_icon;
    if (processedItems !== undefined) updateData.items = processedItems;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (is_active !== undefined) updateData.is_active = is_active;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("sop_checklists")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ checklist: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/checklists/[id] — desactivar zona (no borrar físicamente)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from("sop_checklists")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, checklist: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

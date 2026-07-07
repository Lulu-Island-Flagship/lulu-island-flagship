import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/checklists — listar todas las plantillas (activas e inactivas)
export async function GET() {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from("sop_checklists")
      .select("*")
      .order("service_subtype", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ checklists: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/checklists — crear nueva zona de checklist
export async function POST(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { service_subtype, zone, zone_label, zone_color, zone_icon, items, sort_order } = body;

    if (!service_subtype || !zone || !zone_label || !zone_color || !zone_icon || !items) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Generar IDs nuevos para todos los items (nunca reutilizar IDs existentes)
    const itemsWithIds = items.map((item: { label: string; required: boolean; id?: string }) => ({
      id: item.id || `${zone}_${crypto.randomUUID().split("-")[0]}`,
      label: item.label,
      required: item.required ?? false,
      active: true,
    }));

    const { data, error } = await supabase
      .from("sop_checklists")
      .insert({
        service_subtype,
        zone,
        zone_label,
        zone_color,
        zone_icon,
        items: itemsWithIds,
        sort_order: sort_order ?? 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ checklist: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

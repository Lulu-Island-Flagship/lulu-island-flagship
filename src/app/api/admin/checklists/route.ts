import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/checklists — listar todas las plantillas (activas e inactivas)
export async function GET() {
  const auth = await requireAdminRole("checklists_sop");
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
      .is("deleted_at", null)
      .order("service_subtype", { ascending: true })
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("admin/checklists error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ checklists: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// POST /api/admin/checklists — crear nueva zona de checklist
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("checklists_sop", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      service_subtype,
      zone,
      zone_label,
      zone_color,
      zone_icon,
      items,
      sort_order,
      zone_weight,
      zone_time_hours,
      is_addon_zone,
    } = body;

    if (!service_subtype || !zone || !zone_label || !zone_color || !zone_icon || !items) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // v8.3 E4 (D.7): peso/dificultad de la zona, editable por el admin.
    // Default 1.0 (mismo default que la columna en la migración 104).
    const validatedZoneWeight =
      typeof zone_weight === "number" && zone_weight > 0 ? zone_weight : 1.0;

    // v8.3 E4 (D.7): "tiempo estimado" + decisión explícita de ofrecerla como
    // add-on en el cotizador (migración 132). is_addon_zone default false a
    // propósito — el admin lo activa a mano, nunca es automático.
    const validatedZoneTimeHours =
      typeof zone_time_hours === "number" && zone_time_hours >= 0 ? zone_time_hours : 0.5;
    const validatedIsAddonZone = is_addon_zone === true;

    // Validar que items sea un array no vacío de objetos válidos
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Items must be a non-empty array" }, { status: 400 });
    }
    for (const item of items) {
      if (typeof item.label !== "string" || item.label.trim().length === 0) {
        return NextResponse.json({ error: "Each item must have a non-empty label" }, { status: 400 });
      }
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
        zone_weight: validatedZoneWeight,
        zone_time_hours: validatedZoneTimeHours,
        is_addon_zone: validatedIsAddonZone,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/checklists error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ checklist: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

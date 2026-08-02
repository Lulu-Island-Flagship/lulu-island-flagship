import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import { isValidUuid } from "@/lib/validation";

// PUT /api/admin/checklists/[id] — editar zona existente
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("checklists_sop", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    const body = await request.json();
    const {
      zone_label,
      zone_color,
      zone_icon,
      items,
      sort_order,
      is_active,
      zone_weight,
      zone_time_hours,
      is_addon_zone,
    } = body;

    // Para items: preservar IDs existentes, generar nuevos solo para items nuevos
    // Items "eliminados" se marcan con active: false, no se quitan del array
    // zoneCode se obtiene del body (enviado por frontend) o de la base de datos existente
    const { data: existingZone } = await supabase
      .from("sop_checklists")
      .select("zone")
      .is("deleted_at", null)
      .eq("id", id)
      .single();
    const zoneCode = body.zone || existingZone?.zone || "item";

    const processedItems = items?.map((item: { id?: string; label: string; required: boolean; active?: boolean }) => {
      return {
        id: item.id || `${zoneCode}_${crypto.randomUUID().split('-')[0]}`,
        label: item.label,
        required: item.required ?? false,
        active: item.active !== false,
      };
    });

    const updateData: Record<string, unknown> = {};
    if (zone_label !== undefined) updateData.zone_label = zone_label;
    if (zone_color !== undefined) updateData.zone_color = zone_color;
    if (zone_icon !== undefined) updateData.zone_icon = zone_icon;
    if (processedItems !== undefined) updateData.items = processedItems;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (is_active !== undefined) updateData.is_active = is_active;
    // v8.3 E4 (D.7): peso/dificultad de la zona, editable por el admin.
    if (typeof zone_weight === "number" && zone_weight > 0) updateData.zone_weight = zone_weight;
    // v8.3 E4 (D.7): tiempo estimado + decisión explícita de add-on de cotización.
    if (typeof zone_time_hours === "number" && zone_time_hours >= 0) updateData.zone_time_hours = zone_time_hours;
    if (typeof is_addon_zone === "boolean") updateData.is_addon_zone = is_addon_zone;
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("sop_checklists")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("admin/checklists/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ checklist: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// DELETE /api/admin/checklists/[id]
// Si force=true en el body → borrado físico (solo si no hay historial)
// Si no → soft-delete (is_active = false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("checklists_sop", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";

    if (force) {
      // Verificar historial antes de borrar físicamente
      const { data: hasHistory, error: histError } = await supabase.rpc(
        "check_zone_history",
        { p_checklist_id: id }
      );

      if (histError) {
        console.error("admin/checklists/[id] error:", histError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      if (hasHistory) {
        return NextResponse.json(
          { error: "Cannot delete: this zone has usage history" },
          { status: 409 }
        );
      }

      // Borrado físico
      const { error } = await supabase
        .from("sop_checklists")
        .delete()
        .eq("id", id);

      if (error) {
        console.error("admin/checklists/[id] error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      return NextResponse.json({ success: true, hardDeleted: true }, { status: 200 });
    }

    // Soft-delete por defecto
    const { data, error } = await supabase
      .from("sop_checklists")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("admin/checklists/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ success: true, checklist: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

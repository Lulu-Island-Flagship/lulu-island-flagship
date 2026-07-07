import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// DELETE /api/admin/checklists/service-type/[subtype]
// Borra físicamente todas las zonas de un service_subtype,
// solo si NINGUNA tiene historial en service_checklist_items
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ subtype: string }> }
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
    const { subtype } = await params;
    const decodedSubtype = decodeURIComponent(subtype);

    // 1. Verificar si hay historial para este service_subtype
    const { data: hasHistory, error: histError } = await supabase.rpc(
      "check_service_type_history",
      { p_service_subtype: decodedSubtype }
    );

    if (histError) {
      console.error("History check error:", histError);
      return NextResponse.json({ error: histError.message }, { status: 500 });
    }

    if (hasHistory) {
      return NextResponse.json(
        {
          error: "Cannot delete: this service type has usage history",
          canSoftDelete: true,
        },
        { status: 409 }
      );
    }

    // 2. Borrar físicamente todas las zonas de este service_subtype
    const { error: deleteError } = await supabase
      .from("sop_checklists")
      .delete()
      .eq("service_subtype", decodedSubtype);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// DELETE /api/admin/checklists/service-type/[subtype]
// Soft-delete (invariante B.2.9): marca deleted_at en todas las zonas de un service_subtype
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ subtype: string }> }
) {
  const auth = await requireAdminRole("checklists_sop", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "checklists_sop", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const { supabase } = auth;

  try {
    const { subtype } = await params;
    const decodedSubtype = decodeURIComponent(subtype);
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";

    // 1. Verificar si hay historial para este service_subtype
    const { data: hasHistory, error: histError } = await supabase.rpc(
      "check_service_type_history",
      { p_service_subtype: decodedSubtype }
    );

    if (histError) {
      console.error("History check error:", histError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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

    if (dryRun) {
      // Fix (auditoría externa 2026-07-31): el dry-run solo confirmaba que
      // se PODÍA borrar, pero no decía CUÁNTO se iba a borrar -- el admin
      // confirmaba a ciegas. Se cuentan las zonas (sop_checklists) que este
      // borrado físico va a eliminar para mostrarlas en el modal de
      // confirmación del frontend.
      const { count, error: countError } = await supabase
        .from("sop_checklists")
        .select("id", { count: "exact", head: true })
        .eq("service_subtype", decodedSubtype)
        .is("deleted_at", null);
      if (countError) {
        console.error("dryRun count error:", countError);
      }
      return NextResponse.json(
        { dryRun: true, canDelete: true, affectedZones: count ?? 0 },
        { status: 200 }
      );
    }

    // 2. Soft-delete todas las zonas activas de este service_subtype
    const { error: deleteError } = await supabase
      .from("sop_checklists")
      .update({ deleted_at: new Date().toISOString() })
      .eq("service_subtype", decodedSubtype)
      .is("deleted_at", null);

    if (deleteError) {
      console.error("admin/checklists/service-type/[subtype] error:", deleteError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

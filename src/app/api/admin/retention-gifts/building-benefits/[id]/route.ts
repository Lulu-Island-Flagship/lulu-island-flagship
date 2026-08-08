import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";

/** PATCH /api/admin/retention-gifts/building-benefits/[id] — marca entregado. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const { data, error } = await auth.supabase
    .from("property_manager_building_benefits")
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    console.error("admin/retention-gifts/building-benefits/[id] error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ benefit: data }, { status: 200 });
}

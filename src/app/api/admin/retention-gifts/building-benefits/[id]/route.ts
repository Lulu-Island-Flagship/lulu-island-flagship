import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/** PATCH /api/admin/retention-gifts/building-benefits/[id] — marca entregado. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data, error } = await auth.supabase
    .from("property_manager_building_benefits")
    .update({ delivered_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ benefit: data }, { status: 200 });
}

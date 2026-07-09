import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// POST /api/admin/purchase-orders/[id]/approve — aprobacion de UN TOQUE (D.7.6).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { data: po, error: fetchError } = await supabase
      .from("purchase_orders")
      .select("id, status")
      .eq("id", id)
      .single();

    if (fetchError || !po) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 });
    }

    if (po.status !== "pending_approval") {
      return NextResponse.json(
        { error: `No se puede aprobar: estado actual es '${po.status}', no 'pending_approval'.` },
        { status: 400 }
      );
    }

    const { data: approver } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    const { data: updated, error: updateError } = await supabase
      .from("purchase_orders")
      .update({
        status: "approved",
        approved_by: approver?.id || null,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ purchaseOrder: updated }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

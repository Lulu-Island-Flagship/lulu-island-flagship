import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// POST /api/admin/qc/[orderId]/review — aprobar o rechazar servicio
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
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
    const { orderId } = await params;
    const body = await request.json();
    const { status, note } = body;

    if (!status || !note) {
      return NextResponse.json({ error: "Status and note are required" }, { status: 400 });
    }

    if (!["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Reuse the already-authenticated user from requireSupervisor
    const { data: reviewer } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!reviewer?.id) {
      return NextResponse.json({ error: "Reviewer not found in employees table" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("qc_reviews")
      .update({
        status,
        note,
        reviewer_id: reviewer.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ review: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

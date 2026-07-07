import { NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// POST /api/admin/upsells/[id]/review — marcar upsell como revisado
export async function POST(
  _request: Request,
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
      .from("service_upsells")
      .update({ reviewed_by_admin: true })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Upsell review error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, upsell: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin upsell review error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

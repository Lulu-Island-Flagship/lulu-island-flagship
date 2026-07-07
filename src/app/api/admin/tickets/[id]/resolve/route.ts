import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// POST /api/admin/tickets/[id]/resolve — resolver ticket
export async function POST(
  request: NextRequest,
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
    const body = await request.json();
    const { resolutionNote, status } = body;

    if (!resolutionNote || !status) {
      return NextResponse.json({ error: "Resolution note and status required" }, { status: 400 });
    }

    if (!["resolved", "escalated"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Reuse the already-authenticated user from requireSupervisor
    const { data: resolver } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!resolver?.id) {
      return NextResponse.json({ error: "Resolver not found in employees table" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("tickets_disputas")
      .update({
        status,
        resolution_note: resolutionNote,
        resolved_by: resolver.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ticket: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

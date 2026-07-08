import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/quotes/[id]/review
 *
 * Permite a un supervisor aprobar o rechazar una cotización que cayó bajo el
 * piso de margen preventivo (15%) o fue flaggeada por una regla de negocio.
 *
 * Body: { action: "approve" | "reject", reason?: string }
 */

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Supabase service credentials not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verificar que el caller es supervisor (usando la función is_supervisor de Postgres)
    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabase.auth.getUser(token);
      userId = data.user?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: isSupervisor } = await supabase.rpc("is_supervisor", {
      user_uuid: userId,
    });
    if (!isSupervisor) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const quoteId = params.id;
    const body = await request.json();
    const { action, reason } = body;

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Use 'approve' or 'reject'." },
        { status: 400 }
      );
    }

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, admin_review_required")
      .eq("id", quoteId)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (!quote.admin_review_required) {
      return NextResponse.json(
        { error: "Quote does not require admin review" },
        { status: 409 }
      );
    }

    const update = action === "approve"
      ? {
          admin_review_required: false,
          admin_review_reason: null,
          admin_review_approved_by: userId,
          admin_review_approved_at: new Date().toISOString(),
          admin_review_notes: reason || null,
          updated_at: new Date().toISOString(),
        }
      : {
          status: "expired",
          admin_review_rejected_by: userId,
          admin_review_rejected_at: new Date().toISOString(),
          admin_review_notes: reason || "Rejected by admin",
          updated_at: new Date().toISOString(),
        };

    const { data: updatedQuote, error: updateError } = await supabase
      .from("quotes")
      .update(update)
      .eq("id", quoteId)
      .select()
      .single();

    if (updateError) {
      console.error("Quote review update error:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        quote: updatedQuote,
        action,
        reviewedBy: userId,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Quote review error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

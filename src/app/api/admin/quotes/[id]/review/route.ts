import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * POST /api/admin/quotes/[id]/review
 *
 * Permite a un supervisor aprobar o rechazar una cotización que cayó bajo el
 * piso de margen preventivo (15%) o fue flaggeada por una regla de negocio.
 *
 * Body: { action: "approve" | "reject", reason?: string }
 *
 * v8.3 Sesión P — antes usaba un guard ad-hoc (service-role key + is_supervisor
 * RPC, sin pasar por la matriz RBAC ni dejar log de auditoría). Ahora usa el
 * guard estándar requireAdminRole con el recurso "quotes_review" (ya existente
 * en admin-rbac.ts: owner_admin + ops_coordinator).
 */

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("quotes_review", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const supabase = auth.supabase;
    const userId = auth.user.id;
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
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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

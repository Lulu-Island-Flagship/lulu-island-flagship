import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { exPostReviewOutcome } from "@/lib/safety-abort";
import { safeErrorResponse } from "@/lib/api-errors";

// POST /api/admin/safety-aborts/[id]/review — revisión ex-post OBLIGATORIA
// (punto #5 de B.3: uno de los 6 únicos puntos de intervención humana
// obligatoria). Se exige para TODO aborto seguro, sin excepción, sin importar
// si se auto-aprobó por el fallback de 10 min.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { evidenceSupportsLeader, notes } = body as { evidenceSupportsLeader: boolean; notes?: string };

    if (typeof evidenceSupportsLeader !== "boolean") {
      return NextResponse.json({ error: "evidenceSupportsLeader (boolean) is required" }, { status: 400 });
    }

    const outcome = exPostReviewOutcome(evidenceSupportsLeader);

    const { data: reviewer } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user.id)
      .single();

    const { data, error } = await auth.supabase
      .from("safety_aborts")
      .update({
        ex_post_reviewed_at: new Date().toISOString(),
        ex_post_reviewed_by: reviewer?.id || null,
        evidence_supports_leader: evidenceSupportsLeader,
        sanction_prohibited: outcome.sanctionProhibited,
        review_notes: [outcome.note, notes].filter(Boolean).join(" | "),
      })
      .eq("id", params.id)
      .is("deleted_at", null)
      .select()
      .single();

    if (error) {
      console.error("admin/safety-aborts/[id]/review error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ safetyAbort: data, outcome }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

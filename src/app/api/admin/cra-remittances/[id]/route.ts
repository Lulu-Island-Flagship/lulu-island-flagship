import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/** PATCH /api/admin/cra-remittances/[id] — marcar un período como presentado (filed), con referencia de confirmación y monto real remitido. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { id } = await params;

  try {
    const body = await request.json();
    const { confirmationReference, amountCents } = body as {
      confirmationReference?: string;
      amountCents?: number;
    };
    if (!confirmationReference || confirmationReference.trim().length === 0) {
      return NextResponse.json(
        { error: "confirmationReference is required to mark a remittance as filed" },
        { status: 400 }
      );
    }

    const { data: updated, error } = await auth.supabase
      .from("cra_remittance_periods")
      .update({
        status: "filed",
        filed_at: new Date().toISOString(),
        filed_by: auth.user.id,
        confirmation_reference: confirmationReference.trim(),
        amount_cents: typeof amountCents === "number" ? Math.round(amountCents) : null,
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ period: updated }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

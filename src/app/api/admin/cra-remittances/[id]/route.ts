import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
// Fix M13: Use centralized isValidUuid from @/lib/validation
import { isValidUuid } from "@/lib/validation";
import { safeErrorResponse } from "@/lib/api-errors";

/** PATCH /api/admin/cra-remittances/[id] — marcar un período como presentado (filed), con referencia de confirmación y monto real remitido. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

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

    // Auditoría 2026-07-30 (Bug #4): el UPDATE no filtraba por
    // status = 'pending' -- dos admins podían marcar el mismo período como
    // presentado casi al mismo tiempo y el segundo sobrescribía silenciosamente
    // la confirmation_reference/amount_cents del primero sin ningún aviso.
    // Compare-and-swap real (mismo patrón que
    // admin/purchase-orders/[id]/approve): el filtro de estado esperado va
    // DIRECTO en el UPDATE. Si el período ya no está en 'pending' (otro
    // admin ganó la carrera, o no existe), el UPDATE afecta 0 filas y
    // .single() falla con PGRST116 -- se traduce a 409.
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
      .eq("status", "pending")
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json(
          {
            error:
              "Este período CRA ya no está 'pending' (otro admin ya lo marcó como presentado, o no existe). Recarga e intenta de nuevo.",
          },
          { status: 409 }
        );
      }
      console.error("admin/cra-remittances/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ period: updated }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

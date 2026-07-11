import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { loadDisputeResolutionContext } from "../_shared";

// GET /api/admin/warranty-claims/[id] — detalle de un reclamo con las fotos
// de cierre de TODAS las zonas del checklist (para que el admin vea
// contexto completo, no solo la zona reclamada) + la evidencia del cliente
// + la decisión sugerida por evaluateWarrantyDisputeResolution (preview,
// aún no aplicada — el POST a .../resolve es el que persiste).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { id } = await params;
    const ctx = await loadDisputeResolutionContext(auth.supabase, id);

    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }

    return NextResponse.json(
      {
        claim: ctx.claim,
        zones: ctx.zones,
        clientEvidence: ctx.clientEvidence,
        decision: ctx.decision,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

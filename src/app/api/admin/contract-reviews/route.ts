import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/contract-reviews — v8.3 E9.8. Lista de revisiones
 * disparadas (pendientes y su historial), con el contrato y el resumen
 * de cambios legales para que el admin decida. Recurso "compliance".
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: reviews, error } = await auth.supabase
    .from("contract_reviews")
    .select(
      "id, contract_id, trigger_date, anniversary_date, legal_changes_summary, status, proposed_terms, reviewed_at, dismissal_reason, created_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin/contract-reviews error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const contractIds = Array.from(new Set((reviews || []).map((r) => r.contract_id)));
  const contractById = new Map<string, { user_id: string; service_subtype: string; frequency: string; base_price: number; total: number }>();
  if (contractIds.length > 0) {
    const { data: contracts } = await auth.supabase
      .from("service_contracts")
      .select("id, user_id, service_subtype, frequency, base_price, total")
      .in("id", contractIds);
    for (const c of contracts || []) {
      contractById.set(c.id, {
        user_id: c.user_id,
        service_subtype: c.service_subtype,
        frequency: c.frequency,
        base_price: c.base_price,
        total: c.total,
      });
    }
  }

  const enriched = (reviews || []).map((r) => ({ ...r, contract: contractById.get(r.contract_id) || null }));

  return NextResponse.json(
    { reviews: enriched, pendingCount: enriched.filter((r) => r.status === "pending").length },
    { status: 200 }
  );
}

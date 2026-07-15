import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/live-portfolio?status=candidate — v8.3 E5.15
 *
 * Cola de candidatos surfaceados automáticamente (ver
 * live-portfolio-scan cron). El admin hace el juicio visual de "diferencia
 * antes/después" aquí mismo y aprueba de un toque (POST en
 * /api/admin/live-portfolio/[id]).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "candidate";

  const { data, error } = await supabase
    .from("live_portfolio_candidates")
    .select(
      "id, order_id, zone, service_subtype, anonymous_label, checklist_completion_percent, employee_score_at_selection, candidate_photo_urls, selected_photo_url, status, anonymization_status, approved_at, withdrawal_deadline, withdrawn_at, created_at"
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ candidates: data || [] }, { status: 200 });
}

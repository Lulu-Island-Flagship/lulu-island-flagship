import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluateSafetyAbortEscalation } from "@/lib/safety-abort";

// GET /api/admin/safety-aborts — bandeja de SOS activos + historial.
// v8.3 E7 (D.10 #7): usa el recurso RBAC "tickets" (ya existente en
// admin-rbac.ts) porque un SOS es, en esencia, el ticket de máxima prioridad
// del sistema — no se agrega un recurso nuevo a la matriz.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data, error } = await auth.supabase
      .from("safety_aborts")
      .select(
        "id, order_id, reported_by, reason, first_confirmed_at, second_confirmed_at, sos_started_at, gps_lat, gps_lng, gps_updated_at, acknowledged_at, acknowledged_by, stage, auto_approved, ex_post_reviewed_at, evidence_supports_leader, sanction_prohibited, review_notes, created_at"
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const withComputedStage = (data || []).map((row) => {
      const computed = row.sos_started_at
        ? evaluateSafetyAbortEscalation(row.sos_started_at, nowIso, row.acknowledged_at)
        : null;
      return {
        ...row,
        computed,
        requiresExPostReview: !row.ex_post_reviewed_at,
      };
    });

    return NextResponse.json({ safetyAborts: withComputedStage }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

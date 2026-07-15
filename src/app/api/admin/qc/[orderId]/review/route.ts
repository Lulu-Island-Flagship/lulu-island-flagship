import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluateSampledRejectionRate, decideGamingConsequence } from "@/lib/anti-gaming";

// POST /api/admin/qc/[orderId]/review — aprobar o rechazar servicio
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { orderId } = await params;
    const body = await request.json();
    const { status, note } = body;

    if (!status || !note) {
      return NextResponse.json({ error: "Status and note are required" }, { status: 400 });
    }

    if (!["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Reuse the already-authenticated user from requireSupervisor
    const { data: reviewer } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!reviewer?.id) {
      return NextResponse.json({ error: "Reviewer not found in employees table" }, { status: 403 });
    }

    // Leer ANTES de actualizar: necesitamos saber si esta review venía del
    // muestreo 10% sobre auto-aprobados (sampling_reason ==
    // 'elite_auto_approval_sample') para evaluar manipulación después.
    const { data: existingReview } = await supabase
      .from("qc_reviews")
      .select("employee_id, sampling_reason")
      .eq("order_id", orderId)
      .single();

    const { data, error } = await supabase
      .from("qc_reviews")
      .update({
        status,
        note,
        reviewer_id: reviewer.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let gamingDetection: Record<string, unknown> | null = null;

    // v8.3 E5.2 — solo evaluamos manipulación cuando se RECHAZA un servicio
    // que había caído en la muestra del 10% (habría sido auto-aprobado de
    // no ser por el muestreo). Aprobar una muestra, o rechazar un servicio
    // normal (no muestreado), no es evidencia de nada.
    if (status === "rejected" && existingReview?.sampling_reason === "elite_auto_approval_sample" && existingReview.employee_id) {
      const employeeId = existingReview.employee_id as string;

      const { data: sampledReviews } = await supabase
        .from("qc_reviews")
        .select("status")
        .eq("employee_id", employeeId)
        .eq("sampling_reason", "elite_auto_approval_sample")
        .in("status", ["approved", "rejected"]);

      const evaluation = evaluateSampledRejectionRate(
        (sampledReviews || []).map((r) => ({ status: r.status as "approved" | "rejected" }))
      );

      if (evaluation.exceedsThreshold) {
        const { count: priorDetections } = await supabase
          .from("gaming_detections")
          .select("id", { count: "exact", head: true })
          .eq("employee_id", employeeId)
          .is("deleted_at", null);

        const consequence = decideGamingConsequence(priorDetections || 0);
        const nowIso = new Date().toISOString();
        let retroactiveOrderIds: string[] = [];

        if (consequence.action === "auto_approval_revoked") {
          await supabase
            .from("employees")
            .update({ auto_approval_revoked_at: nowIso })
            .eq("id", employeeId);

          const { data: recentAuto } = await supabase
            .from("qc_reviews")
            .select("order_id")
            .eq("employee_id", employeeId)
            .eq("status", "auto")
            .order("created_at", { ascending: false })
            .limit(consequence.retroactiveReviewCount);

          retroactiveOrderIds = (recentAuto || []).map((r) => r.order_id as string);
          if (retroactiveOrderIds.length > 0) {
            await supabase
              .from("qc_reviews")
              .update({ status: "pending", note: "Revisión retroactiva por manipulación detectada (E5.2)" })
              .in("order_id", retroactiveOrderIds);
          }
        } else {
          await supabase
            .from("employees")
            .update({
              trust_level: "suspended",
              suspension_reason: `Segunda detección de manipulación del muro QC (${(evaluation.rejectionRate * 100).toFixed(1)}% de rechazo en muestra de ${evaluation.sampleSize}). Revisión humana requerida antes de cualquier decisión de despido (B.2.23).`,
            })
            .eq("id", employeeId);
        }

        const { data: detectionRow } = await supabase
          .from("gaming_detections")
          .insert({
            employee_id: employeeId,
            detection_number: consequence.detectionNumber,
            triggering_qc_review_id: data.id,
            sampled_rejection_rate: evaluation.rejectionRate,
            action_taken: consequence.action,
            retroactive_review_order_ids: retroactiveOrderIds,
            notes: `Muestra: ${evaluation.sampleSize}, rechazados: ${evaluation.rejectedCount}`,
          })
          .select()
          .single();

        gamingDetection = detectionRow;
      }
    }

    return NextResponse.json({ review: data, gamingDetection }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

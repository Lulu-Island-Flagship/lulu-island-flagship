import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publishUnifiedAlert } from "@/lib/unified-alerts";

/**
 * GET /api/cron/qc-rework-expiry
 *
 * v8.3 E5 (auditoría 2026-07-18, migración 190) — cierra el flujo del
 * estado 'rework' del muro QC. Un servicio en 'rework' tiene 30 minutos
 * (qc_reviews.rework_deadline) para que el empleado resubmita
 * (/api/empleado/qc/[orderId]/resubmit). Si el timer vence sin
 * resubmisión, esta corrida (cada 15 minutos -- relajado de cada 5 min en la
 * auditoría m-2 2026-07-20b: el peor caso solo retrasa el auto-rechazo hasta
 * 15 min más allá del deadline de 30 min real, un margen aceptable que no
 * cambia el resultado para el empleado y reduce la cuenta de invocaciones
 * sub-diarias que exigen Vercel Pro) lo pasa automáticamente a
 * 'rejected' -- consecuencia documentada del vencimiento del plazo, NUNCA
 * una suspensión ni despido automático (esas siguen siendo decisión humana,
 * B.2.23). Se deja rastro en tickets_disputas y una alerta en la bandeja
 * unificada para que el admin sepa que un rework se venció sin resolver.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = getSupabaseClient();
    const nowIso = new Date().toISOString();

    const { data: expired, error } = await supabase
      .from("qc_reviews")
      .select("id, order_id, employee_id, rework_deadline")
      .eq("status", "rework")
      .lt("rework_deadline", nowIso);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let expiredCount = 0;
    for (const review of expired || []) {
      const { error: updateError } = await supabase
        .from("qc_reviews")
        .update({
          status: "rejected",
          rework_expired_at: nowIso,
          // Fix Kimi-B1 (auditoría externa Kimi Code, 2026-07-21, verificado
          // y confirmado real): esta fila quedaba 'rejected' sin
          // reviewed_at, sin ninguna traza de CUÁNDO se resolvió (reviewer_id
          // se deja NULL a propósito -- fue el sistema, no un humano, quien
          // rechazó por vencimiento; el note ya lo aclara).
          reviewed_at: nowIso,
          note: "Rechazado automáticamente: venció el timer de rework sin resubmisión",
        })
        .eq("id", review.id)
        .eq("status", "rework"); // guard contra doble-procesamiento en corridas solapadas

      if (updateError) {
        console.error(`qc-rework-expiry update error for ${review.id}:`, updateError);
        continue;
      }

      expiredCount++;

      await supabase.from("tickets_disputas").insert({
        order_id: review.order_id,
        employee_id: review.employee_id,
        type: "discrepancy",
        priority: "medium",
        status: "open",
        context: {
          reason: "qc_rework_deadline_expired",
          qc_review_id: review.id,
        },
      });

      await publishUnifiedAlert(supabase, {
        sourceModule: "qc_rework",
        sourceTable: "qc_reviews",
        sourceId: review.id,
        tier: "can_wait",
        severity: "p2_automatic",
        title: "Rework de QC vencido sin resubmisión",
        summary: `El servicio de la orden ${review.order_id} venció su plazo de 30 min en rework y fue rechazado automáticamente.`,
      });
    }

    return NextResponse.json({ success: true, expiredCount }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

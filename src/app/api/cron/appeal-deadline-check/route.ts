import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { requireCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/appeal-deadline-check
 *
 * v8.3 E5 (auditoría 2026-07-18, migración 191) — field_audits.appeal_deadline
 * es el plazo del ADMIN para resolver una apelación ya presentada por el
 * empleado (72h desde appealed_at, fijado en /api/empleado/appeal). Nada
 * consultaba ese plazo -- una apelación podía quedar sin resolver
 * indefinidamente sin que nadie se enterara. Esta corrida horaria:
 *   1. Alerta (una sola vez, respond_10min) cuando quedan <12h y aún no se
 *      había alertado ("se acerca").
 *   2. Alerta (una sola vez, respond_10min, p1_urgent) cuando el plazo ya
 *      venció sin appeal_resolved_at ("ya venció").
 * No toma NINGUNA acción automática sobre la apelación misma (no la
 * resuelve, no cambia el score) -- solo la hace visible al admin, tal como
 * pide el criterio de la auditoría.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const APPROACHING_WINDOW_HOURS = 12;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = getSupabaseClient();
    const now = new Date();

    const { data: pendingAppeals, error } = await supabase
      .from("field_audits")
      .select(
        "id, employee_id, appeal_deadline, appeal_deadline_alert_sent_at, appeal_deadline_expired_alert_sent_at"
      )
      .not("appealed_at", "is", null)
      .is("appeal_resolved_at", null)
      .not("appeal_deadline", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let approachingAlerted = 0;
    let expiredAlerted = 0;

    for (const audit of pendingAppeals || []) {
      const deadline = new Date(audit.appeal_deadline as string);
      const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursRemaining < 0 && !audit.appeal_deadline_expired_alert_sent_at) {
        await publishUnifiedAlert(supabase, {
          sourceModule: "appeal_deadline",
          sourceTable: "field_audits",
          sourceId: audit.id,
          tier: "respond_10min",
          severity: "p1_urgent",
          title: "Apelación vencida sin resolver",
          summary: `La apelación de la auditoría ${audit.id} venció su plazo de 72h para resolución del admin sin appeal_resolved_at.`,
        });

        await supabase
          .from("field_audits")
          .update({ appeal_deadline_expired_alert_sent_at: now.toISOString() })
          .eq("id", audit.id);

        expiredAlerted++;
        continue;
      }

      if (
        hoursRemaining >= 0 &&
        hoursRemaining <= APPROACHING_WINDOW_HOURS &&
        !audit.appeal_deadline_alert_sent_at
      ) {
        await publishUnifiedAlert(supabase, {
          sourceModule: "appeal_deadline",
          sourceTable: "field_audits",
          sourceId: audit.id,
          tier: "respond_10min",
          severity: "p1_urgent",
          title: "Apelación por vencer",
          summary: `Quedan menos de ${APPROACHING_WINDOW_HOURS}h para resolver la apelación de la auditoría ${audit.id} (plazo del admin, 72h).`,
        });

        await supabase
          .from("field_audits")
          .update({ appeal_deadline_alert_sent_at: now.toISOString() })
          .eq("id", audit.id);

        approachingAlerted++;
      }
    }

    return NextResponse.json(
      { success: true, approachingAlerted, expiredAlerted },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

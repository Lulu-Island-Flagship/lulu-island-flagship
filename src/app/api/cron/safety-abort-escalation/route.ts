import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { evaluateSafetyAbortEscalation, type SafetyAbortStage } from "@/lib/safety-abort";
import { publishUnifiedAlert } from "@/lib/unified-alerts";

/**
 * v8.3 ROUND 2 — hallazgo crítico de seguridad: esta ruta usaba
 * createServerClient + cookies() (sesión de navegador), pero Vercel Cron la
 * invoca server-to-server sin cookies -- auth.uid() es NULL. safety_aborts
 * solo tiene política de UPDATE para "reported_by = auth.uid()" o
 * is_supervisor(auth.uid()) (migración 069); con auth.uid() NULL ninguna
 * de las dos aplica, así que el UPDATE de stage/auto_approved de este cron
 * quedaba bloqueado por RLS en cada corrida. Efecto real: el SOS del
 * empleado (FIX-1) se registraba pero NUNCA avanzaba de "sos_started" a
 * "auto_approved" pasando por las etapas de escalación (llamada a admin a
 * los 2 min, Admin de Emergencia a los 4 min) -- exactamente la excepción
 * de campo #7 (D.10), la más crítica de seguridad humana. Mismo fix que
 * dispatch-scheduler y wellbeing-chemical-reassign: service role para un
 * cron server-to-server, protegido por el mismo guard CRON_SECRET.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

// GET /api/cron/safety-abort-escalation — recalcula y persiste la etapa de
// todo SOS activo (no reconocido, no auto-aprobado todavía). Debe correr con
// frecuencia corta (ej. cada minuto) dado que la ventana más corta es 2 min.
//
// v8.3 E7 (D.10 #7): esta ruta SOLO recalcula/persiste el estado (stage,
// auto_approved). El envío real de SMS/llamada al admin ("llamada auto a
// admin (2 min)", "Admin de Emergencia (4 min)") requiere el adaptador de
// Twilio (C.1/C.2) que todavía no existe en el repo — no se inventa aquí.
// Cuando ese adaptador exista, este cron es el punto exacto donde debe
// dispararse la notificación al cruzar cada umbral.
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

  const supabase = getSupabaseClient();

  try {
    const { data: activeAborts, error } = await supabase
      .from("safety_aborts")
      .select("id, sos_started_at, acknowledged_at, stage, auto_approved")
      .is("deleted_at", null)
      .is("acknowledged_at", null)
      .neq("stage", "auto_approved")
      .not("sos_started_at", "is", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    let updated = 0;
    const transitions: { id: string; from: string; to: string }[] = [];

    for (const row of activeAborts || []) {
      const result = evaluateSafetyAbortEscalation(row.sos_started_at as string, nowIso, null);
      if (result.stage !== row.stage) {
        const { error: updateError } = await supabase
          .from("safety_aborts")
          .update({ stage: result.stage, auto_approved: result.autoApproved })
          .eq("id", row.id);
        if (!updateError) {
          updated += 1;
          transitions.push({ id: row.id, from: row.stage, to: result.stage });

          // Fix Kimi-A11 (auditoría externa Kimi Code, 2026-07-21,
          // verificado y confirmado real): este cron solo persistía
          // stage/auto_approved -- nunca publicaba en unified_alerts al
          // AVANZAR de etapa. El POST inicial (/api/empleado/safety-abort)
          // sí alerta al activar el SOS, pero una escalación (nadie
          // reconoció a tiempo, situación más urgente) no generaba NINGUNA
          // señal nueva -- un admin solo se enteraría reabriendo
          // manualmente el registro del SOS. El adaptador real de
          // Twilio (SMS/llamada) sigue sin existir (ver comentario
          // arriba) -- esto solo cubre la bandeja unificada interna, que
          // sí existe hoy.
          const alertBySeverityStage: Partial<
            Record<SafetyAbortStage, { severity: "p0_safety"; title: string }>
          > = {
            escalated_admin_call: {
              severity: "p0_safety",
              title: "SOS sin reconocer 2+ min -- escalado a llamada de admin",
            },
            escalated_emergency_admin: {
              severity: "p0_safety",
              title: "SOS sin reconocer 4+ min -- escalado a Admin de Emergencia",
            },
            auto_approved: {
              severity: "p0_safety",
              title: "SOS auto-aprobado por seguridad (10+ min sin reconocer) -- revisión ex-post obligatoria",
            },
          };

          const alertInfo = alertBySeverityStage[result.stage];
          if (alertInfo) {
            await publishUnifiedAlert(supabase, {
              sourceModule: "safety_abort",
              sourceTable: "safety_aborts",
              sourceId: row.id,
              tier: "respond_10min",
              severity: alertInfo.severity,
              title: alertInfo.title,
              summary: `SOS ${row.id}: ${result.minutesElapsed.toFixed(1)} min transcurridos sin reconocimiento (sos_started_at=${row.sos_started_at}).`,
            });
          }
        }
      }
    }

    return NextResponse.json(
      { checked: activeAborts?.length || 0, updated, transitions },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

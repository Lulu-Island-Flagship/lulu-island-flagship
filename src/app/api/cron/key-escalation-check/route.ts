import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isKeyProblemEscalationDue, KEY_PROBLEM_ESCALATION_MINUTES } from "@/lib/key-handling";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { requireCronAuth } from "@/lib/cron-auth";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/cron/key-escalation-check — v8.3 E7 fix de auditoría.
 *
 * `isKeyProblemEscalationDue()` (src/lib/key-handling.ts) existía desde la
 * migración 048 pero estaba huérfana: ningún cron la invocaba. Un
 * key_handling_log con method='problem' se guardaba con
 * escalation_resolved_as='pending' (POST /api/empleado/llaves) y ahí se
 * quedaba para siempre -- el timer de 15 min del spec (D.7.5: "en persona /
 * lockbox / tercero / problema -> escala 15 min -> no-show documentado")
 * nunca disparaba nada real.
 *
 * Este cron recalcula el timer para cada "problema" sin resolver y, cuando
 * ya pasaron los 15 min, publica la escalación real a la bandeja unificada
 * (unified_alerts, migración 147) con tier 'respond_10min' -- incidente de
 * acceso a la propiedad del cliente bloqueado en campo, mismo nivel de
 * urgencia que un fallback de despacho. Usa
 * key_handling_log.escalation_notified_at (migración 185) para no publicar
 * la misma alerta en cada corrida mientras el problema sigue pendiente.
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY (server-to-server, sin sesión de usuario) --
 * mismo patrón que safety-abort-escalation / wellbeing-chemical-reassign:
 * con el cliente anon+cookies, is_supervisor(auth.uid()) evalúa NULL y la
 * RLS de key_handling_log (solo UPDATE de supervisores) bloquea el UPDATE
 * silenciosamente.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: pending, error } = await supabase
      .from("key_handling_log")
      .select("id, order_id, escalated_at, escalation_resolved_as, escalation_notified_at")
      .eq("method", "problem")
      .eq("escalation_resolved_as", "pending")
      .is("deleted_at", null)
      .is("escalation_notified_at", null)
      .not("escalated_at", "is", null);

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    let escalated = 0;

    for (const row of pending || []) {
      const due = isKeyProblemEscalationDue(row.escalated_at as string, nowIso, null);
      if (!due) continue;

      const alertResult = await publishUnifiedAlert(supabase, {
        sourceModule: "key_handling",
        sourceTable: "key_handling_log",
        sourceId: row.id as string,
        tier: "respond_10min",
        severity: "p1_urgent",
        title: "Problema de acceso a llaves sin resolver",
        summary: `Reportado hace más de ${KEY_PROBLEM_ESCALATION_MINUTES} min sin resolución (orden ${row.order_id}). Requiere intervención admin (no-show a documentar si no se resuelve).`,
      });

      if (alertResult.success) {
        await supabase
          .from("key_handling_log")
          .update({ escalation_notified_at: nowIso })
          .eq("id", row.id);
        escalated++;
      }
    }

    return NextResponse.json(
      { checked: (pending || []).length, escalated },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

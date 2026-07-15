import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { evaluateReEngagement, type MarketingLogEntry } from "@/lib/communication-preferences";

/**
 * POST /api/cron/communication-reengagement
 *
 * v8.3 E6.5 — CASL: "re-engagement (5 emails sin abrir → último intento →
 * fuera)". Recorre las cuentas actualmente opt-in a marketing, mira sus
 * últimos envíos de marketing por email (communication_log, más reciente
 * primero) y da de baja automáticamente a las que acumulan 5 seguidos sin
 * apertura -- evaluateReEngagement() decide, este cron solo ejecuta.
 *
 * No es una sanción: es la misma cortesía que exige la ley (dejar de
 * insistir a quien claramente no está leyendo) y libera cupo de throttling
 * semanal (communications.ts) para clientes que sí abren.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: optedInProfiles, error: profilesError } = await supabase
      .from("client_profiles")
      .select("user_id")
      .eq("marketing_opt_in", true);

    if (profilesError) {
      return NextResponse.json({ error: profilesError.message }, { status: 500 });
    }

    let evaluated = 0;
    let autoUnsubscribed = 0;

    for (const profile of optedInProfiles ?? []) {
      evaluated += 1;

      const { data: logs, error: logsError } = await supabase
        .from("communication_log")
        .select("status, channel, sent_at")
        .eq("user_id", profile.user_id)
        .eq("category", "marketing")
        .eq("channel", "email")
        .order("created_at", { ascending: false })
        .limit(10);

      if (logsError || !logs) continue;

      const entries: MarketingLogEntry[] = logs.map((l) => ({
        status: l.status,
        channel: l.channel,
        sentAt: l.sent_at,
      }));

      const evaluation = evaluateReEngagement(entries);

      if (evaluation.shouldAutoUnsubscribe) {
        const nowIso = new Date().toISOString();
        await supabase
          .from("client_profiles")
          .update({
            marketing_opt_in: false,
            marketing_opt_in_updated_at: nowIso,
            auto_unsubscribed_at: nowIso,
          })
          .eq("user_id", profile.user_id);
        autoUnsubscribed += 1;
      }
    }

    return NextResponse.json({ evaluated, autoUnsubscribed }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

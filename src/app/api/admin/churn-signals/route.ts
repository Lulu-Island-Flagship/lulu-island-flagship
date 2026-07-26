import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { detectChurnSignal } from "@/lib/churn-detection";
import { dispatchCommunication } from "@/lib/send-communication";

const AUTO_MESSAGE_EVENT_KEY: Record<string, string> = {
  survey_20: "churn_survey_recurring_60d",
  discount_30_percent: "churn_discount_sporadic_90d",
};

/**
 * GET  /api/admin/churn-signals — bitácora de señales de fuga.
 * POST /api/admin/churn-signals:
 *   { action: "flag_manual", clientUserId, cancelledWithCompetitorMention?, teamScorePrevious?, teamScoreCurrent? }
 *     -- para las 2 reglas que detectChurnSignal() no puede calcular solo
 *        (mención de competidor, caída de score de equipo). Mismo
 *        clasificador que el cron, pero con inputs que solo un humano
 *        conoce.
 *   { action: "resolve", id, resolutionNotes? }
 *     -- para survey_20/discount_30_percent dispara dispatchCommunication
 *        (catálogo E6, con su propio throttling); para
 *        personal_intervention/flag_unreported_dispute solo registra que el
 *        admin ya atendió el ítem (esas dos son trabajo humano, no un
 *        mensaje automatizado).
 *   { action: "dismiss", id, resolutionNotes? }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("churn_signals")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("admin/churn-signals error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ churnSignals: data || [] }, { status: 200 });
}

interface Body {
  action?: string;
  clientUserId?: string;
  cancelledWithCompetitorMention?: boolean;
  teamScorePrevious?: number;
  teamScoreCurrent?: number;
  id?: string;
  resolutionNotes?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.action === "flag_manual") {
    if (!body.clientUserId) {
      return NextResponse.json({ error: "clientUserId es obligatorio" }, { status: 400 });
    }
    const teamScoreTrend =
      body.teamScorePrevious !== undefined && body.teamScoreCurrent !== undefined
        ? { previous: body.teamScorePrevious, current: body.teamScoreCurrent }
        : undefined;

    const signal = detectChurnSignal({
      pattern: "sporadic", // no aplica para las 2 reglas manuales, el clasificador las evalúa primero
      daysSinceLastService: 0,
      cancelledWithCompetitorMention: body.cancelledWithCompetitorMention === true,
      teamScoreTrend,
    });

    if (signal.action === "none" || signal.action === "survey_20" || signal.action === "discount_30_percent") {
      return NextResponse.json(
        { error: "Los inputs dados no generan una señal manual válida (competidor o caída de score de equipo)." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("churn_signals")
      .insert({
        client_user_id: body.clientUserId,
        action: signal.action,
        reason: signal.reason,
        source: "manual",
      })
      .select()
      .single();

    if (error) {
      console.error("admin/churn-signals error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ churnSignal: data }, { status: 201 });
  }

  if (body.action === "resolve" || body.action === "dismiss") {
    if (!body.id) {
      return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
    }

    const { data: signalRow, error: fetchError } = await supabase
      .from("churn_signals")
      .select("*")
      .eq("id", body.id)
      .single();

    if (fetchError || !signalRow) {
      return NextResponse.json({ error: "Señal no encontrada" }, { status: 404 });
    }

    if (body.action === "resolve") {
      const eventKey = AUTO_MESSAGE_EVENT_KEY[signalRow.action];
      if (eventKey) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", signalRow.client_user_id)
          .maybeSingle();
        const { data: clientProfile } = await supabase
          .from("client_profiles")
          .select("preferred_languages")
          .eq("user_id", signalRow.client_user_id)
          .maybeSingle();
        const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] ||
          "en") as "en" | "zh" | "fr";

        await dispatchCommunication(supabase, {
          eventKey,
          userId: signalRow.client_user_id,
          language,
          vars: {
            client_name: profile?.full_name || "cliente",
            survey_link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/cuenta`,
            reactivation_link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/cotizador`,
          },
        });
      }
    }

    const { data: employeeRow } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const { data: updated, error: updateError } = await supabase
      .from("churn_signals")
      .update({
        status: body.action === "resolve" ? "actioned" : "dismissed",
        actioned_at: new Date().toISOString(),
        actioned_by: employeeRow?.id ?? null,
        resolution_notes: body.resolutionNotes?.trim() || null,
      })
      .eq("id", body.id)
      .select()
      .single();

    if (updateError) {
      console.error("admin/churn-signals error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ churnSignal: updated }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}

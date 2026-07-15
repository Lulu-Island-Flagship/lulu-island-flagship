import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  decideCampaignTrigger,
  type DemandSignals,
  type SeasonalCampaign,
} from "@/lib/demand-signals";

/**
 * GET /api/admin/seasonal-campaigns — catálogo de 5 campañas + evaluaciones
 * recientes.
 *
 * POST /api/admin/seasonal-campaigns — v8.3 E10 (D.10.4), mismo patrón de
 * aprobación de un toque que /api/admin/marketing (blog):
 *   { action: "evaluate", signals } — corre decideCampaignTrigger() (función
 *     pura ya probada en demand-signals.ts) contra las 5 campañas activas
 *     con las señales de demanda dadas. NO hay adaptador real de clima
 *     (Environment Canada) todavía -- las señales las provee el admin a
 *     mano, igual de honesto que el patrón "not_configured" de sms.ts.
 *   { action: "approve" | "reject", runId } — decisión humana de un toque.
 *   { action: "dispatch", runId } — marca una corrida aprobada como
 *     despachada. El envío real (comunicación al cliente) queda fuera de
 *     alcance de esta tanda -- se conecta después a dispatchCommunication
 *     (send-communication.ts) cuando exista la plantilla de campaña.
 */
export async function GET() {
  const auth = await requireAdminRole("upsells_review");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: campaigns, error: campaignsError } = await auth.supabase
    .from("seasonal_campaigns")
    .select("*")
    .eq("is_active", true)
    .order("suggested_month", { ascending: true });
  if (campaignsError) {
    return NextResponse.json({ error: campaignsError.message }, { status: 500 });
  }

  const { data: runs, error: runsError } = await auth.supabase
    .from("seasonal_campaign_runs")
    .select("*")
    .is("deleted_at", null)
    .order("evaluated_at", { ascending: false })
    .limit(30);
  if (runsError) {
    return NextResponse.json({ error: runsError.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: campaigns || [], runs: runs || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("upsells_review", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase, user } = auth;

  try {
    const body = await request.json();

    if (body.action === "evaluate") {
      const signals = (body.signals || {}) as DemandSignals;
      const now = new Date();
      const currentMonth = now.getUTCMonth() + 1;
      const currentYear = now.getUTCFullYear();

      const { data: campaigns, error: campaignsError } = await supabase
        .from("seasonal_campaigns")
        .select("campaign_key, suggested_month")
        .eq("is_active", true);
      if (campaignsError) {
        return NextResponse.json({ error: campaignsError.message }, { status: 500 });
      }

      const results = [];
      for (const c of (campaigns || []) as { campaign_key: SeasonalCampaign; suggested_month: number }[]) {
        const isSuggestedDateReached = currentMonth >= c.suggested_month;
        const decision = decideCampaignTrigger(c.campaign_key, signals, isSuggestedDateReached);

        // Reemplaza cualquier corrida 'suggested' previa para esta
        // campaña+año (índice único de la migración 141) en vez de
        // duplicar -- una nueva evaluación siempre reemplaza a la anterior
        // mientras no se haya decidido.
        await supabase
          .from("seasonal_campaign_runs")
          .delete()
          .eq("campaign_key", c.campaign_key)
          .eq("campaign_year", currentYear)
          .eq("status", "suggested");

        const { data: run, error: insertError } = await supabase
          .from("seasonal_campaign_runs")
          .insert({
            campaign_key: c.campaign_key,
            campaign_year: currentYear,
            signals,
            applied_factors: [],
            multiplier: decision.multiplier,
            should_trigger: decision.shouldTrigger,
            reason: decision.reason,
            status: "suggested",
          })
          .select()
          .single();

        if (insertError) {
          console.error("seasonal-campaigns evaluate insert error:", insertError);
          continue;
        }
        results.push(run);
      }

      return NextResponse.json({ runs: results }, { status: 200 });
    }

    if (body.action === "approve" || body.action === "reject") {
      const { runId } = body;
      if (!runId) {
        return NextResponse.json({ error: "runId is required" }, { status: 400 });
      }

      const { data: run } = await supabase
        .from("seasonal_campaign_runs")
        .select("id, status")
        .eq("id", runId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (run.status !== "suggested") {
        return NextResponse.json({ error: `Cannot ${body.action} a run in status '${run.status}'` }, { status: 400 });
      }

      const { data: updated, error: updateError } = await supabase
        .from("seasonal_campaign_runs")
        .update({
          status: body.action === "approve" ? "approved" : "rejected",
          decided_by: user.id,
          decided_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ run: updated }, { status: 200 });
    }

    if (body.action === "dispatch") {
      const { runId } = body;
      const { data: run } = await supabase
        .from("seasonal_campaign_runs")
        .select("id, status")
        .eq("id", runId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (run.status !== "approved") {
        return NextResponse.json({ error: "Only an approved run can be dispatched" }, { status: 400 });
      }

      const { data: updated, error: updateError } = await supabase
        .from("seasonal_campaign_runs")
        .update({ status: "dispatched" })
        .eq("id", runId)
        .select()
        .single();

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ run: updated }, { status: 200 });
    }

    return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

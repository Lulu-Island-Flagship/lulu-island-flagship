import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  decideCampaignTrigger,
  type DemandSignals,
  type SeasonalCampaign,
} from "@/lib/demand-signals";
import { dispatchCommunication } from "@/lib/send-communication";
import { safeErrorResponse } from "@/lib/api-errors";

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
 *   { action: "dispatch", runId } — corrida aprobada: itera clientes
 *     objetivo (client_profiles B2C con marketing_opt_in=true) y llama
 *     dispatchCommunication() (send-communication.ts) con el event_key
 *     'seasonal_campaign_dispatch' (migración 186) para cada uno, dejando
 *     que el throttling anti-fatiga (arbitrateThrottle) y el gate CASL de
 *     dispatchCommunication decidan por cliente si se envía, se pospone o
 *     falla. Al final marca la corrida como 'dispatched'.
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
    console.error("admin/seasonal-campaigns error:", campaignsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: runs, error: runsError } = await auth.supabase
    .from("seasonal_campaign_runs")
    .select("*")
    .is("deleted_at", null)
    .order("evaluated_at", { ascending: false })
    .limit(30);
  if (runsError) {
    console.error("admin/seasonal-campaigns error:", runsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
        console.error("admin/seasonal-campaigns error:", campaignsError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
        console.error("admin/seasonal-campaigns error:", updateError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      return NextResponse.json({ run: updated }, { status: 200 });
    }

    if (body.action === "dispatch") {
      const { runId } = body;
      const { data: run } = await supabase
        .from("seasonal_campaign_runs")
        .select("id, status, campaign_key")
        .eq("id", runId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (run.status !== "approved") {
        return NextResponse.json({ error: "Only an approved run can be dispatched" }, { status: 400 });
      }

      const { data: campaign } = await supabase
        .from("seasonal_campaigns")
        .select("display_name")
        .eq("campaign_key", run.campaign_key)
        .maybeSingle();
      const campaignName = campaign?.display_name || run.campaign_key;

      // Clientes objetivo: mismo patrón que otros despachos masivos de
      // marketing (cron communication-reengagement) -- B2C con
      // marketing_opt_in=true. dispatchCommunication() sigue siendo el
      // único punto que decide envío real (throttle + gate CASL), esto
      // solo arma la lista de candidatos.
      const { data: targetProfiles, error: targetError } = await supabase
        .from("client_profiles")
        .select("user_id, preferred_languages")
        .eq("marketing_opt_in", true)
        .eq("account_type", "b2c");
      if (targetError) {
        console.error("admin/seasonal-campaigns error:", targetError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      let dispatchedCount = 0;
      let postponedCount = 0;
      let failedCount = 0;
      for (const target of targetProfiles || []) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", target.user_id)
          .maybeSingle();
        const language = ((target.preferred_languages as string[] | undefined)?.[0] || "en") as "en" | "zh" | "fr";

        const result = await dispatchCommunication(supabase, {
          eventKey: "seasonal_campaign_dispatch",
          userId: target.user_id,
          language,
          vars: {
            client_name: profile?.full_name || "cliente",
            campaign_name: campaignName,
            booking_link: `${process.env.NEXT_PUBLIC_APP_URL || ""}/quote`,
          },
          marketingWeight: 1,
        });

        if (result.status === "sent" || result.status === "queued") dispatchedCount++;
        else if (result.status === "postponed") postponedCount++;
        else failedCount++;
      }

      const { data: updated, error: updateError } = await supabase
        .from("seasonal_campaign_runs")
        .update({ status: "dispatched" })
        .eq("id", runId)
        .select()
        .single();

      if (updateError) {
        console.error("admin/seasonal-campaigns error:", updateError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      return NextResponse.json(
        {
          run: updated,
          dispatchSummary: {
            total: (targetProfiles || []).length,
            dispatched: dispatchedCount,
            postponed: postponedCount,
            failed: failedCount,
          },
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

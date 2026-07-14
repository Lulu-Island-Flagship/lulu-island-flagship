import { NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  computeDisputeFreeRatePercent,
  computeBatchCaptureSuccessRatePercent,
  computeNetMargin,
  semaphoreForMinThreshold,
  DASHBOARD_THRESHOLDS,
} from "@/lib/dashboard-metrics";

/**
 * GET /api/admin/dashboard-metrics
 *
 * v8.3 D.13 — "4+1 números" del dashboard del dueño. Ventana fija de los
 * últimos 30 días para las 4 métricas operativas; el margen neto real usa
 * el MES CALENDARIO actual porque los costos fijos son mensuales por
 * definición (D.3) y mezclar ventanas rompería el prorrateo.
 *
 * "finance" ya es un recurso RBAC existente restringido a owner_admin
 * (admin-rbac.ts) — se reutiliza tal cual porque el margen neto real es
 * información financiera sensible, igual que pricing_settings/payroll.
 */
export async function GET() {
  const auth = await requireAdminRole("finance");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 30);
    const windowStartIso = windowStart.toISOString().split("T")[0];
    const todayIso = now.toISOString().split("T")[0];

    const monthStartIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

    // ---- 1. Servicios sin disputa (últimos 30 días) ----
    const { count: completedCount, error: completedError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("service_date", windowStartIso)
      .lte("service_date", todayIso);

    if (completedError) console.error("dashboard-metrics completedCount error:", completedError);

    const { data: completedIdsData, error: completedIdsError } = await supabase
      .from("orders")
      .select("id")
      .eq("status", "completed")
      .gte("service_date", windowStartIso)
      .lte("service_date", todayIso);

    if (completedIdsError) console.error("dashboard-metrics completedIds error:", completedIdsError);

    const completedIds = (completedIdsData || []).map((o: { id: string }) => o.id);

    let disputedCount = 0;
    if (completedIds.length > 0) {
      const { count, error: disputedError } = await supabase
        .from("warranty_claims")
        .select("order_id", { count: "exact", head: true })
        .in("order_id", completedIds);
      if (disputedError) console.error("dashboard-metrics disputedCount error:", disputedError);
      disputedCount = count || 0;
    }

    const disputeFreeRatePercent = computeDisputeFreeRatePercent({
      completedServicesCount: completedCount || 0,
      servicesWithDisputeCount: disputedCount,
    });

    // ---- 2. Batch Capture exitoso (últimos 30 días, vía Shadow Ledger) ----
    const windowStartTimestamp = windowStart.toISOString();
    const { count: successfulCaptureCount, error: successError } = await supabase
      .from("shadow_ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "balance_captured")
      .gte("occurred_at", windowStartTimestamp);
    if (successError) console.error("dashboard-metrics successfulCapture error:", successError);

    const { count: failedCaptureCount, error: failedError } = await supabase
      .from("shadow_ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "capture_failed")
      .gte("occurred_at", windowStartTimestamp);
    if (failedError) console.error("dashboard-metrics failedCapture error:", failedError);

    const batchCaptureSuccessRatePercent = computeBatchCaptureSuccessRatePercent({
      successfulCaptureCount: successfulCaptureCount || 0,
      failedCaptureCount: failedCaptureCount || 0,
    });

    // ---- 3. Score promedio de equipos (semana más reciente con datos) ----
    // Se promedia server-side y SOLO se devuelve el agregado — nunca los
    // scores por equipo individuales (invariante B.2.21, mismo espíritu que
    // get_team_top3: el ranking exacto de posiciones 4+ nunca se expone,
    // pero un promedio agregado no revela ninguna posición individual).
    const { data: latestWeekRow } = await supabase
      .from("team_weekly_scores")
      .select("week_start")
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    let teamScoreAverage: number | null = null;
    if (latestWeekRow?.week_start) {
      const { data: weekScores, error: weekScoresError } = await supabase
        .from("team_weekly_scores")
        .select("efficiency_score, quality_score, punctuality_score, commercial_score")
        .eq("week_start", latestWeekRow.week_start);

      if (weekScoresError) {
        console.error("dashboard-metrics weekScores error:", weekScoresError);
      } else if (weekScores && weekScores.length > 0) {
        const composites = weekScores.map(
          (s: { efficiency_score: number; quality_score: number; punctuality_score: number; commercial_score: number }) =>
            s.efficiency_score * 0.4 + s.quality_score * 0.3 + s.punctuality_score * 0.2 + s.commercial_score * 0.1
        );
        teamScoreAverage = Math.round((composites.reduce((a, b) => a + b, 0) / composites.length) * 100) / 100;
      }
    }

    // ---- 4 & 5. Margen de contribución + margen neto real ----
    let avgContributionMarginPercent: number | null = null;
    let avgOrderValueDollars: number | null = null;

    if (completedIds.length > 0) {
      const { data: quoteIdRows } = await supabase
        .from("orders")
        .select("quote_id")
        .in("id", completedIds);

      const quoteIds = (quoteIdRows || []).map((r: { quote_id: string }) => r.quote_id).filter(Boolean);

      if (quoteIds.length > 0) {
        const { data: quotesData, error: quotesError } = await supabase
          .from("quotes")
          .select("estimated_margin_contribution, total")
          .in("id", quoteIds);

        if (quotesError) {
          console.error("dashboard-metrics quotes error:", quotesError);
        } else if (quotesData && quotesData.length > 0) {
          const margins = quotesData
            .map((q: { estimated_margin_contribution: number | null }) => q.estimated_margin_contribution)
            .filter((m): m is number => m !== null && m !== undefined);
          const totals = quotesData
            .map((q: { total: number | null }) => q.total)
            .filter((t): t is number => t !== null && t !== undefined);

          if (margins.length > 0) {
            avgContributionMarginPercent =
              Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 100) / 100;
          }
          if (totals.length > 0) {
            avgOrderValueDollars = Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100;
          }
        }
      }
    }

    // Costos fijos vigentes + si alguna vez se configuraron de verdad (más
    // que el seed en $0 -- ver comentario en la migración 134).
    const { data: fixedCostsRow } = await supabase
      .from("fixed_costs_settings")
      .select("monthly_fixed_costs_cents, reason")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    const monthlyFixedCostsCents = fixedCostsRow?.monthly_fixed_costs_cents ?? 0;
    const fixedCostsConfigured = monthlyFixedCostsCents > 0;

    const { count: servicesCountThisMonth, error: monthCountError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("service_date", monthStartIso)
      .lte("service_date", todayIso);
    if (monthCountError) console.error("dashboard-metrics monthCount error:", monthCountError);

    const netMargin = computeNetMargin({
      avgContributionMarginPercent,
      avgOrderValueDollars,
      monthlyFixedCostsCents,
      servicesCountThisMonth: servicesCountThisMonth || 0,
      fixedCostsConfigured,
    });

    return NextResponse.json(
      {
        windowStart: windowStartIso,
        windowEnd: todayIso,
        metrics: {
          disputeFreeRate: {
            valuePercent: disputeFreeRatePercent,
            thresholdPercent: DASHBOARD_THRESHOLDS.disputeFreeRatePercent,
            semaphore: semaphoreForMinThreshold(disputeFreeRatePercent, DASHBOARD_THRESHOLDS.disputeFreeRatePercent),
            completedServicesCount: completedCount || 0,
            servicesWithDisputeCount: disputedCount,
          },
          batchCaptureSuccessRate: {
            valuePercent: batchCaptureSuccessRatePercent,
            thresholdPercent: DASHBOARD_THRESHOLDS.batchCaptureSuccessRatePercent,
            semaphore: semaphoreForMinThreshold(
              batchCaptureSuccessRatePercent,
              DASHBOARD_THRESHOLDS.batchCaptureSuccessRatePercent
            ),
            successfulCaptureCount: successfulCaptureCount || 0,
            failedCaptureCount: failedCaptureCount || 0,
          },
          teamScoreAverage: {
            value: teamScoreAverage,
            threshold: DASHBOARD_THRESHOLDS.teamScoreAverage,
            semaphore: semaphoreForMinThreshold(teamScoreAverage, DASHBOARD_THRESHOLDS.teamScoreAverage),
            weekStart: latestWeekRow?.week_start ?? null,
          },
          contributionMargin: {
            valuePercent: avgContributionMarginPercent,
            thresholdPercent: DASHBOARD_THRESHOLDS.contributionMarginPercent,
            semaphore: semaphoreForMinThreshold(
              avgContributionMarginPercent,
              DASHBOARD_THRESHOLDS.contributionMarginPercent
            ),
          },
          netMargin: {
            valuePercent: netMargin.netMarginPercent,
            thresholdPercent: DASHBOARD_THRESHOLDS.netMarginPercent,
            semaphore: semaphoreForMinThreshold(netMargin.netMarginPercent, DASHBOARD_THRESHOLDS.netMarginPercent),
            fixedCostPerServiceDollars: netMargin.fixedCostPerServiceDollars,
            fixedCostsConfigured,
            formula: "Margen_neto_real = Margen_contribucion - (Costos_fijos_mes / servicios_del_mes)",
          },
        },
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("dashboard-metrics fatal error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

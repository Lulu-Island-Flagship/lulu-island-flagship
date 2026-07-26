import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  computeNpsScore,
  evaluateFunnelConversionRate,
  evaluateReferralRate,
  evaluateChurnRate,
  meetsNpsTarget,
} from "@/lib/growth-metrics";

const PERIOD_DAYS = 30;
// Ventana de "cliente activo" para el denominador de churn: tuvo al menos un
// pedido en los 120 días previos al inicio del periodo. Aproximación
// honesta -- no existe una definición formal de "cliente activo" en el
// schema, así que se documenta aquí en vez de inventar precisión que no hay.
const ACTIVE_CLIENT_WINDOW_DAYS = 120;

// GET /api/admin/growth-metrics — scorecard consolidado (D.10.13):
// funnel de conversión, tasa de referidos, tasa de churn, y NPS de los
// últimos 30 días, cada uno con su umbral evaluado. CAC/LTV NO se
// recalculan aquí -- viven en /api/admin/attribution porque requieren
// gasto por canal que el admin ingresa manualmente; este endpoint no
// duplica esa entrada de datos.
//
// Resource "finance": mismo bucket que attribution/seo-local/partners.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const periodStartIso = new Date(now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const activeWindowStartIso = new Date(periodStartIso).getTime() - ACTIVE_CLIENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const activeWindowStartDate = new Date(activeWindowStartIso).toISOString();

  // --- Funnel: cotizaciones creadas vs. órdenes reservadas a partir de ellas ---
  const { data: quotesInPeriod, error: quotesError } = await supabase
    .from("quotes")
    .select("id")
    .gte("created_at", periodStartIso);
  if (quotesError) {
    console.error("admin/growth-metrics error:", quotesError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const quoteIds = (quotesInPeriod || []).map((q: { id: string }) => q.id);

  let ordersFromThoseQuotes = 0;
  if (quoteIds.length > 0) {
    const { count, error: ordersError } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("quote_id", quoteIds);
    if (ordersError) {
      console.error("admin/growth-metrics error:", ordersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    ordersFromThoseQuotes = count || 0;
  }
  const funnel = evaluateFunnelConversionRate(quoteIds.length, ordersFromThoseQuotes);

  // --- Referidos: clientes nuevos del periodo con referred_by_code ---
  const { data: newClients, error: newClientsError } = await supabase
    .from("client_profiles")
    .select("referred_by_code")
    .gte("created_at", periodStartIso);
  if (newClientsError) {
    console.error("admin/growth-metrics error:", newClientsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const newClientsTotal = (newClients || []).length;
  const newClientsReferred = (newClients || []).filter((c: { referred_by_code: string | null }) => !!c.referred_by_code).length;
  const referral = evaluateReferralRate(newClientsTotal, newClientsReferred);

  // --- Churn: señales generadas en el periodo / clientes activos antes del periodo ---
  const { data: activeOrders, error: activeOrdersError } = await supabase
    .from("orders")
    .select("user_id")
    .gte("service_datetime", activeWindowStartDate)
    .lt("service_datetime", periodStartIso);
  if (activeOrdersError) {
    console.error("admin/growth-metrics error:", activeOrdersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const activeClientsBeforePeriod = new Set((activeOrders || []).map((o: { user_id: string }) => o.user_id)).size;

  const { data: churnSignalsInPeriod, error: churnError } = await supabase
    .from("churn_signals")
    .select("client_user_id")
    .gte("created_at", periodStartIso)
    .is("deleted_at", null);
  if (churnError) {
    console.error("admin/growth-metrics error:", churnError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const churnedClients = new Set((churnSignalsInPeriod || []).map((c: { client_user_id: string }) => c.client_user_id)).size;
  const churn = evaluateChurnRate(activeClientsBeforePeriod, churnedClients);

  // --- NPS: respuestas del periodo ---
  const { data: npsResponses, error: npsError } = await supabase
    .from("nps_surveys")
    .select("score")
    .gte("responded_at", periodStartIso)
    .not("score", "is", null)
    .is("deleted_at", null);
  if (npsError) {
    console.error("admin/growth-metrics error:", npsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  const nps = computeNpsScore((npsResponses || []).map((r: { score: number }) => ({ score: r.score })));

  return NextResponse.json(
    {
      periodDays: PERIOD_DAYS,
      funnel,
      referral,
      churn: { ...churn, activeClientsBeforePeriod, churnedClients },
      nps: { ...nps, meetsTarget: meetsNpsTarget(nps.npsScore) },
      note: "CAC/LTV se calculan en /admin/attribution (requieren gasto por canal ingresado manualmente).",
    },
    { status: 200 }
  );
}

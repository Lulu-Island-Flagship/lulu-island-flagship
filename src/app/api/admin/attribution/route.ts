import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import {
  calculateLtv,
  calculateCac,
  isCacHealthy,
  calculateMarketingBudgetRange,
  allocateBudgetByChannel,
  type ChannelPerformance,
} from "@/lib/attribution";

/**
 * GET  /api/admin/attribution — CAC/LTV por canal + reparto de presupuesto
 *      sugerido (D.10.2). src/lib/attribution.ts existía 100% testeado pero
 *      sin dato real: ni el campo "¿cómo nos conociste?" en la cotización
 *      (migración 146, quotes.acquisition_channel) ni el gasto por canal
 *      (marketing_channel_spend, misma migración, registrado a mano — no
 *      hay integración real con plataformas de anuncios).
 * POST /api/admin/attribution — { action: "record_spend", channel, spendMonth (YYYY-MM-01), spendCents, notes? }
 *
 * Regla dura del spec: "Nunca mostrar LTV sin su fórmula visible" -- por eso
 * la respuesta siempre incluye `ltv.formula` y `ltv.inputs`, y el frontend
 * no puede renderizar solo el número.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Nuevos clientes por canal: primera cotización de cada usuario, en los
  // últimos 90 días, agrupada por acquisition_channel.
  const { data: recentQuotes, error: quotesError } = await supabase
    .from("quotes")
    .select("user_id, acquisition_channel, created_at")
    .not("acquisition_channel", "is", null)
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: true });

  if (quotesError) {
    console.error("admin/attribution error:", quotesError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const firstQuoteByUser = new Map<string, string>(); // user_id -> channel
  for (const q of recentQuotes || []) {
    if (!firstQuoteByUser.has(q.user_id)) {
      firstQuoteByUser.set(q.user_id, q.acquisition_channel);
    }
  }
  const newCustomersByChannel = new Map<string, number>();
  for (const channel of firstQuoteByUser.values()) {
    newCustomersByChannel.set(channel, (newCustomersByChannel.get(channel) ?? 0) + 1);
  }

  // 2. Gasto del mes actual por canal.
  const { data: spendRows, error: spendError } = await supabase
    .from("marketing_channel_spend")
    .select("channel, spend_cents")
    .eq("spend_month", monthStart)
    .is("deleted_at", null);

  if (spendError) {
    console.error("admin/attribution error:", spendError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const spendByChannel = new Map<string, number>();
  for (const s of spendRows || []) {
    spendByChannel.set(s.channel, (spendByChannel.get(s.channel) ?? 0) + s.spend_cents);
  }

  const allChannels = new Set([...newCustomersByChannel.keys(), ...spendByChannel.keys()]);
  const channelPerformance: ChannelPerformance[] = [];
  const channelBreakdown = [];
  for (const channel of allChannels) {
    const spendCents = spendByChannel.get(channel) ?? 0;
    const newCustomers = newCustomersByChannel.get(channel) ?? 0;
    const cacCents = calculateCac(spendCents, newCustomers);
    channelBreakdown.push({ channel, spendCents, newCustomers, cacCents });
    channelPerformance.push({ channel, cacCents, ltvCents: 0 }); // ltvCents filled below once global LTV is known
  }

  // 3. LTV global (D.3 fórmula) a partir de órdenes completadas de los
  // últimos 90 días -- ticket promedio y margen de contribución promedio
  // real; frecuencia mensual y retención con supuestos conservadores
  // documentados hasta que haya suficiente historial de cohortes.
  const { data: completedOrders, error: ordersError } = await supabase
    .from("orders")
    .select("total, user_id")
    .eq("status", "completed")
    .gte("service_date", ninetyDaysAgo.slice(0, 10));

  if (ordersError) {
    console.error("admin/attribution error:", ordersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const orders = completedOrders || [];
  const avgTicketCents =
    orders.length > 0 ? Math.round((orders.reduce((sum, o) => sum + Number(o.total || 0), 0) / orders.length) * 100) : 0;

  const { data: quotesWithMargin } = await supabase
    .from("quotes")
    .select("estimated_margin_contribution")
    .not("estimated_margin_contribution", "is", null)
    .gte("created_at", ninetyDaysAgo)
    .limit(500);
  const marginSamples = (quotesWithMargin || []).map((q) => Number(q.estimated_margin_contribution));
  const contributionMarginRatio =
    marginSamples.length > 0 ? marginSamples.reduce((a, b) => a + b, 0) / marginSamples.length : 0.25;

  const distinctClients = new Set(orders.map((o) => o.user_id)).size;
  const monthlyFrequency = distinctClients > 0 ? orders.length / distinctClients / 3 : 0; // 90 dias = 3 meses

  const ltv = calculateLtv({
    avgTicketCents,
    monthlyFrequency,
    contributionMarginRatio,
    observedRetentionMonths: 6, // supuesto conservador documentado -- sin suficiente historial de cohortes reales aún
  });

  for (const cp of channelPerformance) {
    cp.ltvCents = ltv.valueCents;
  }

  const { data: lastMonthRevenueRows } = await supabase
    .from("orders")
    .select("total")
    .eq("status", "completed")
    .gte("service_date", new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10))
    .lt("service_date", monthStart);
  const previousMonthRevenueCents = Math.round(
    (lastMonthRevenueRows || []).reduce((sum, o) => sum + Number(o.total || 0), 0) * 100
  );
  const budgetRange = calculateMarketingBudgetRange(previousMonthRevenueCents);
  const suggestedAllocation = allocateBudgetByChannel(budgetRange.maxCents, channelPerformance);

  const channels = channelBreakdown.map((c) => ({
    ...c,
    ltvCents: ltv.valueCents,
    cacHealthy: isCacHealthy(c.cacCents, ltv.valueCents),
    suggestedBudgetCents: suggestedAllocation[c.channel] ?? 0,
  }));

  return NextResponse.json(
    {
      month: monthStart,
      channels,
      ltv,
      budgetRange,
      previousMonthRevenueCents,
    },
    { status: 200 }
  );
}

interface RecordSpendBody {
  action?: string;
  channel?: string;
  spendMonth?: string;
  spendCents?: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const { supabase } = auth;

  let body: RecordSpendBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.action !== "record_spend") {
    return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
  }
  if (!body.channel || !body.spendMonth || body.spendCents === undefined) {
    return NextResponse.json({ error: "channel, spendMonth y spendCents son obligatorios" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-01$/.test(body.spendMonth)) {
    return NextResponse.json({ error: "spendMonth debe ser el primer día del mes (YYYY-MM-01)" }, { status: 400 });
  }

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("marketing_channel_spend")
    .upsert(
      {
        channel: body.channel,
        spend_month: body.spendMonth,
        spend_cents: body.spendCents,
        notes: body.notes?.trim() || null,
        recorded_by: employeeRow?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel,spend_month" }
    )
    .select()
    .single();

  if (error) {
    console.error("admin/attribution error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ spend: data }, { status: 201 });
}

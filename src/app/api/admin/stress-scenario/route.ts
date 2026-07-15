import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import {
  simulateRevenueDropScenario,
  crossesMandatoryReviewThreshold,
  meetsExpansionReserveRule,
} from "@/lib/financial-stress-scenario";

// GET /api/admin/stress-scenario — historial de corridas.
// POST /api/admin/stress-scenario — { currentMonthlyRevenueCents, currentMonthlyFixedCostsCents,
//   currentMonthlyVariableCostsCents, biweeklyPayrollCents, currentCashOnHandCents,
//   ownerPresent, leversDocumented?, notes? }
//   Calcula el escenario -30%×3 meses y la regla de reserva, y persiste la corrida.
//
// Resource "finance": única acción financiera estratégica de todo E11.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("financial_stress_scenario_runs")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ runs: data || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const required = ["currentMonthlyRevenueCents", "currentMonthlyFixedCostsCents", "currentMonthlyVariableCostsCents"];
  for (const key of required) {
    if (typeof body[key] !== "number") {
      return NextResponse.json({ error: `${key} (number) es obligatorio` }, { status: 400 });
    }
  }

  const months = simulateRevenueDropScenario({
    currentMonthlyRevenueCents: body.currentMonthlyRevenueCents,
    currentMonthlyFixedCostsCents: body.currentMonthlyFixedCostsCents,
    currentMonthlyVariableCostsCents: body.currentMonthlyVariableCostsCents,
  });
  const crossesThreshold = crossesMandatoryReviewThreshold(months);

  let reserveCheck = null;
  if (typeof body.currentCashOnHandCents === "number" && typeof body.biweeklyPayrollCents === "number") {
    reserveCheck = meetsExpansionReserveRule({
      currentCashOnHandCents: body.currentCashOnHandCents,
      monthlyFixedCostsCents: body.currentMonthlyFixedCostsCents,
      biweeklyPayrollCents: body.biweeklyPayrollCents,
    });
  }

  const { data, error } = await supabase
    .from("financial_stress_scenario_runs")
    .insert({
      run_by: user?.id ?? null,
      current_monthly_revenue_cents: body.currentMonthlyRevenueCents,
      current_monthly_fixed_costs_cents: body.currentMonthlyFixedCostsCents,
      current_monthly_variable_costs_cents: body.currentMonthlyVariableCostsCents,
      crosses_mandatory_review_threshold: crossesThreshold,
      levers_documented: Array.isArray(body.leversDocumented) ? body.leversDocumented : [],
      owner_present: !!body.ownerPresent,
      notes: body.notes?.trim() || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ run: data, months, crossesThreshold, reserveCheck }, { status: 201 });
}

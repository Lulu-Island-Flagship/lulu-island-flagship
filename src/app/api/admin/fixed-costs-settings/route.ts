import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET/PATCH /api/admin/fixed-costs-settings
 *
 * v8.3 D.3/D.13/E9: costos fijos mensuales, único insumo que faltaba para
 * calcular el margen neto real. Mismo patrón de versionado que
 * /api/admin/pricing-settings (cierra la fila vigente, inserta una nueva).
 */
export async function GET() {
  const auth = await requireAdminRole("finance");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: current, error } = await auth.supabase
    .from("fixed_costs_settings")
    .select("id, monthly_fixed_costs_cents, effective_from, reason, created_at")
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("admin/fixed-costs-settings error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ current: current || null }, { status: 200 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { monthlyFixedCostsDollars, reason } = body;

    if (
      monthlyFixedCostsDollars === undefined ||
      typeof monthlyFixedCostsDollars !== "number" ||
      monthlyFixedCostsDollars < 0
    ) {
      return NextResponse.json({ error: "monthlyFixedCostsDollars must be a non-negative number" }, { status: 400 });
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required for the audit trail" }, { status: 400 });
    }

    const todayIso = new Date().toISOString().split("T")[0];
    const monthlyFixedCostsCents = Math.round(monthlyFixedCostsDollars * 100);

    const { data: previous } = await auth.supabase
      .from("fixed_costs_settings")
      .select("id")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previous) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      await auth.supabase
        .from("fixed_costs_settings")
        .update({ effective_to: yesterday.toISOString().split("T")[0] })
        .eq("id", previous.id);
    }

    const { data: newSetting, error: insertError } = await auth.supabase
      .from("fixed_costs_settings")
      .insert({
        monthly_fixed_costs_cents: monthlyFixedCostsCents,
        effective_from: todayIso,
        reason: reason.trim(),
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("admin/fixed-costs-settings error:", insertError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ setting: newSetting }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

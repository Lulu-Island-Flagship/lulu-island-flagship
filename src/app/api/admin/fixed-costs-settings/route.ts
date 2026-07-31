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

    // Auditoría 2026-07-30 (Bug #3): antes esto era un update (cerrar la
    // fila vigente) seguido de un insert (fila nueva) en dos pasos
    // separados -- si el insert fallaba después de cerrar la anterior, no
    // quedaba ninguna fila vigente. set_current_fixed_costs (migración 249)
    // hace ambos pasos dentro de una sola transacción Postgres: todo o
    // nada.
    const { data: newSetting, error: rpcError } = await auth.supabase
      .rpc("set_current_fixed_costs", {
        p_monthly_fixed_costs_cents: monthlyFixedCostsCents,
        p_effective_from: todayIso,
        p_reason: reason.trim(),
        p_created_by: auth.user.id,
      })
      .single();

    if (rpcError) {
      if (rpcError.code === "42501") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (rpcError.code === "22023") {
        return NextResponse.json({ error: rpcError.message }, { status: 400 });
      }
      console.error("admin/fixed-costs-settings error:", rpcError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ setting: newSetting }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

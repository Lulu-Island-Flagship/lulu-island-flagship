import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { calculateMinimumWageImpact, listAffectedContracts } from "@/lib/economic-params";

// GET /api/admin/economic-params — parametros vigentes
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("payroll", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("payroll_settings")
    .select("id, bc_min_wage_hourly, minimum_day_rate, standard_day_hours, effective_from")
    .is("effective_to", null)
    .order("effective_from", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data }, { status: 200 });
}

// POST /api/admin/economic-params/simulate — v8.3 B.3.2: simula el impacto de
// un nuevo salario minimo SIN aplicarlo. Espera UN clic humano por separado
// (ver PATCH) para aplicar. Nunca escribe en esta llamada.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("payroll", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { newMinimumWage } = body;

    if (typeof newMinimumWage !== "number" || newMinimumWage <= 0) {
      return NextResponse.json({ error: "newMinimumWage inválido" }, { status: 400 });
    }

    const { data: current, error: currentError } = await supabase
      .from("payroll_settings")
      .select("bc_min_wage_hourly, minimum_day_rate, standard_day_hours")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .single();

    if (currentError || !current) {
      return NextResponse.json({ error: "No se encontró configuración de nómina vigente" }, { status: 500 });
    }

    const impact = calculateMinimumWageImpact({
      currentMinimumWage: Number(current.bc_min_wage_hourly),
      newMinimumWage,
      currentMinimumDayRate: Number(current.minimum_day_rate),
      standardDayHours: Number(current.standard_day_hours),
    });

    const { data: contracts } = await supabase
      .from("service_contracts")
      .select("id")
      .is("deleted_at", null);

    // Nota: service_contracts no tiene hoy un day_rate propio por contrato —
    // el Day Rate mínimo es global (payroll_settings). Se lista el conteo de
    // contratos activos como referencia de alcance, no como ajuste por contrato.
    const affected = listAffectedContracts(
      (contracts || []).map((c) => ({ contractId: c.id, currentDayRate: Number(current.minimum_day_rate) })),
      impact.suggestedMinimumDayRate
    );

    return NextResponse.json({ impact, affectedContractsCount: affected.filter((a) => a.needsAdjustment).length }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/admin/economic-params — aplica el cambio (UN clic humano).
// Pasa por admin_update_config para que quede snapshot + motivo obligatorio.
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("payroll", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { settingsId, newMinimumWage, newMinimumDayRate, reason } = body;

    if (!settingsId || typeof newMinimumWage !== "number" || typeof newMinimumDayRate !== "number" || !reason) {
      return NextResponse.json({ error: "settingsId, newMinimumWage, newMinimumDayRate y reason son requeridos" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("admin_update_config", {
      p_table: "payroll_settings",
      p_id: settingsId,
      p_changes: { bc_min_wage_hourly: newMinimumWage, minimum_day_rate: newMinimumDayRate },
      p_reason: reason,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ result: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

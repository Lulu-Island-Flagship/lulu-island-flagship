import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/pricing-settings
 *
 * Devuelve la tarifa objetivo vigente y el historial de cambios.
 */
export async function GET() {
  const auth = await requireAdminRole("pricing_settings");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data: current, error: currentError } = await auth.supabase
      .from("pricing_settings")
      .select("id, target_hourly_rate, effective_from, effective_to, reason, created_by, created_at, updated_at")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .single();

    if (currentError) {
      console.error("Pricing settings fetch error:", currentError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const { data: history, error: historyError } = await auth.supabase
      .from("pricing_settings_audit_logs")
      .select("id, previous_rate, new_rate, previous_effective_from, new_effective_from, reason, changed_by, created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    if (historyError) {
      console.error("Pricing settings audit fetch error:", historyError);
    }

    return NextResponse.json(
      {
        current: current || null,
        history: history || [],
        fallbackRate: 70.0,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/pricing-settings
 *
 * Actualiza la tarifa objetivo. La fila vigente se cierra (effective_to) y se
 * crea una nueva fila vigente con la nueva tarifa, de forma atómica vía la
 * función RPC set_current_pricing_settings (migración 250), más audit log.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("pricing_settings", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { targetHourlyRate, effectiveFrom, reason } = body;

    if (targetHourlyRate === undefined || typeof targetHourlyRate !== "number" || targetHourlyRate <= 0) {
      return NextResponse.json({ error: "targetHourlyRate must be a positive number" }, { status: 400 });
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required for audit log" }, { status: 400 });
    }

    const today = new Date().toISOString().split("T")[0];
    const newEffectiveFrom = effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
      ? effectiveFrom
      : today;

    if (newEffectiveFrom < today) {
      return NextResponse.json({ error: "effectiveFrom cannot be in the past" }, { status: 400 });
    }

    // Obtener tarifa vigente actual para audit log
    const { data: previous } = await auth.supabase
      .from("pricing_settings")
      .select("id, target_hourly_rate, effective_from")
      .is("effective_to", null)
      .order("effective_from", { ascending: false })
      .limit(1)
      .single();

    // Auditoría 2026-07-30: antes esto era un update (cerrar la fila
    // vigente) seguido de un insert (fila nueva) en dos pasos separados --
    // si el insert fallaba después de cerrar la anterior, no quedaba
    // ninguna fila vigente. set_current_pricing_settings (migración 250,
    // mismo patrón que set_current_fixed_costs en la migración 249) hace
    // ambos pasos dentro de una sola transacción Postgres: todo o nada.
    const { data: newSetting, error: rpcError } = await auth.supabase
      .rpc("set_current_pricing_settings", {
        p_target_hourly_rate: targetHourlyRate,
        p_effective_from: newEffectiveFrom,
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
      console.error("Pricing settings RPC error:", rpcError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Audit log
    await auth.supabase.from("pricing_settings_audit_logs").insert({
      previous_rate: previous?.target_hourly_rate ?? null,
      new_rate: targetHourlyRate,
      previous_effective_from: previous?.effective_from ?? null,
      new_effective_from: newEffectiveFrom,
      reason: reason.trim(),
      changed_by: auth.user.id,
    });

    return NextResponse.json(
      {
        setting: newSetting,
        previousRate: previous?.target_hourly_rate ?? null,
        message: `Target hourly rate updated to $${targetHourlyRate}/hr effective ${newEffectiveFrom}.`,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

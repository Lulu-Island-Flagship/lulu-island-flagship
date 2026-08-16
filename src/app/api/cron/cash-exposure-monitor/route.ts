import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVancouverTodayString } from "@/lib/date-utils";
import { evaluateDailyCashExposure } from "@/lib/cash-reserve";
import { toCentsBigInt } from "@/lib/money";
import { safeErrorResponse } from "@/lib/api-errors";
import { requireCronAuth } from "@/lib/cron-auth";

/**
 * POST /api/cron/cash-exposure-monitor
 *
 * Job programado cada hora (v8.3 E2.9): "tope de exposición diaria
 * (Holds pendientes > X% de caja → alerta)".
 *
 * Ver nota en migración 074: el tope se implementa como monto ABSOLUTO
 * configurable (cash_exposure_settings), no como % de caja real, porque
 * el sistema no tiene integración de saldo bancario. Este job suma los
 * Holds autorizados y aún no cobrados de HOY y los compara contra el tope.
 * Una sola alerta por día (UNIQUE alert_date en cash_exposure_alerts).
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const todayStr = getVancouverTodayString();

  const { data: monitorFlag } = await supabase
    .from("feature_flags")
    .select("activo")
    .eq("nombre", "cash_exposure_monitor_enabled")
    .single();

  if (!monitorFlag?.activo) {
    return NextResponse.json(
      { skipped: true, reason: "cash_exposure_monitor_enabled flag is off" },
      { status: 200 }
    );
  }

  try {
    const { data: settings } = await supabase
      .from("cash_exposure_settings")
      .select("daily_exposure_cap_cents")
      .order("effective_from", { ascending: false })
      .limit(1)
      .single();

    const dailyCapCents = settings?.daily_exposure_cap_cents ?? 2000000;

    // Holds autorizados hoy que todavía no han sido capturados (ni por
    // el batch de las 7PM ni por el retry de las 10PM).
    const { data: pendingOrders, error } = await supabase
      .from("orders")
      .select("hold_authorized_amount_cents, hold_amount_cents")
      .eq("service_date", todayStr)
      .not("status", "in", "(cancelled,no_show)")
      // Fix (auditoría externa de infraestructura, 2026-08-02): mismo bug de
      // soft-delete que batch-capture -- sin este filtro, una orden borrada
      // lógicamente seguía sumando a la exposición de caja calculada, pudiendo
      // disparar (o suprimir) alertas basadas en un monto que ya no representa
      // riesgo real.
      .is("deleted_at", null)
      .is("hold_captured_at", null);

    if (error) {
      console.error("Cash exposure monitor fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // RAÍZ-3 (2026-07-21, migración 229): hold_authorized_amount_cents/
    // hold_amount_cents ya están en centavos -- sin *100.
    // v6.0 (ext-financial): suma bigint exacta en el borde de persistencia
    // (toCentsBigInt parsea el NUMERIC reportado como number sin Math.round).
    const pendingExposureCents = (pendingOrders || []).reduce(
      (sum, o) =>
        sum + toCentsBigInt(o.hold_authorized_amount_cents ?? o.hold_amount_cents ?? 0),
      0n,
    );

    const evaluation = evaluateDailyCashExposure({
      pendingExposureCents,
      dailyCapCents: toCentsBigInt(dailyCapCents),
    });

    if (evaluation.overCap) {
      // UNIQUE(alert_date) evita duplicar la alerta si el job corre varias
      // veces el mismo día; upsert con ignoreDuplicates mantiene la primera.
      await supabase
        .from("cash_exposure_alerts")
        .upsert(
          {
            alert_date: todayStr,
            pending_exposure_cents: Number(evaluation.pendingExposureCents),
            cap_cents: Number(evaluation.dailyCapCents),
            exposure_ratio: evaluation.exposureRatio,
          },
          { onConflict: "alert_date", ignoreDuplicates: true }
        );
    }

    return NextResponse.json(
      {
        success: true,
        date: todayStr,
        ...evaluation,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

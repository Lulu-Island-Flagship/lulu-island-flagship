
import { NextRequest, NextResponse } from "next/server";
import {
  calculatePrice,
  calculateHold,
  getTargetHourlyRate,
  getCurrentHHETable,
  ServiceType,
} from "@/lib/pricing";
import { type PricingRule, type RuleContext } from "@/lib/rules";
import { getZoneDemand } from "@/lib/zone-demand";
import { getVancouverTodayString, getDayOfWeekFromDateString } from "@/lib/date-utils";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
import { QUOTE_CLIENT_COLUMNS } from "@/lib/client-visible-columns";

function deriveClientType(servicesCount: number, clientScore: number): "new" | "returning" | "elite" {
  if (servicesCount === 0) return "new";
  if (servicesCount >= 10 && clientScore > 80) return "elite";
  return "returning";
}

function deriveOrganicLoad(
  petsCount: number,
  petsType: string,
  residents: number
): "low" | "medium" | "high" {
  if (petsCount >= 3 || residents >= 5) return "high";
  const hasLongHair =
    petsType.toLowerCase().includes("long") ||
    petsType.toLowerCase().includes("largo") ||
    petsType.toLowerCase().includes("multiple");
  if (hasLongHair || residents >= 3) return "medium";
  return "low";
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}
/**
 * Recalcula el precio de una quote cuando el cliente elige fecha de servicio.
 * El precio original se congela en el wizard; este endpoint aplica el recargo
 * logístico por fin de semana / día no preferencial de forma server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { quoteId, serviceDate } = body;

    if (!quoteId || !serviceDate) {
      return NextResponse.json(
        { error: "Missing quoteId or serviceDate" },
        { status: 400 }
      );
    }

    // Validar formato de fecha YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      return NextResponse.json({ error: "Invalid serviceDate format" }, { status: 400 });
    }

    const { data: quote, error: quoteError } = await supabase
      .from("quotes")
      .select(QUOTE_CLIENT_COLUMNS)
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json(
        { error: "Quote not found or unauthorized" },
        { status: 404 }
      );
    }

    if (quote.status !== "pending") {
      return NextResponse.json(
        { error: "Quote is not available for recalculation" },
        { status: 409 }
      );
    }

    const frozenUntil = new Date(quote.price_frozen_until);
    if (frozenUntil < new Date()) {
      return NextResponse.json(
        { error: "Quote has expired" },
        { status: 410 }
      );
    }

    // Calcular día de la semana y preferencia según la fecha elegida.
    // Fix (auditoría externa, hallazgo A10): antes se usaba
    // `new Date(\`${serviceDate}T00:00:00\`).getDay()`, que interpreta el
    // string como hora LOCAL DEL RUNTIME -- si el servidor corre en una zona
    // horaria distinta a Vancouver, un cambio de horario de verano/entorno
    // podía desalinear el día calculado. `getDayOfWeekFromDateString` calcula
    // el día de la semana directamente de los componentes Y/M/D del string,
    // sin depender de ninguna zona horaria del runtime.
    const [selYear, selMonth, selDay] = String(serviceDate).split("-").map(Number);
    if (!selYear || !selMonth || !selDay || isNaN(new Date(selYear, selMonth - 1, selDay).getTime())) {
      return NextResponse.json({ error: "Invalid serviceDate" }, { status: 400 });
    }

    const dayOfWeek = getDayOfWeekFromDateString(serviceDate);
    const isPreferredDay = dayOfWeek >= 1 && dayOfWeek <= 5; // lun-vie preferidos

    // Leer tarifa objetivo vigente
    const targetHourlyRate = await getTargetHourlyRate(supabase);
    const hheTable = await getCurrentHHETable(supabase);

    // Reglas de pricing activas + contexto de día se arman ANTES de llamar a
    // calculatePrice, que ahora invoca applyPricingRules() internamente (fix
    // auditoría externa, hallazgo #1).
    const { data: rulesData } = await supabase
      .from("pricing_rules")
      .select("id, name, description, condition_json, action_type, action_value, priority, max_applicable, is_active")
      .is("deleted_at", null)
      .eq("is_active", true);

    const rules: PricingRule[] = (rulesData || []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      description: r.description as string | undefined,
      conditionJson: r.condition_json as Record<string, unknown>,
      actionType: r.action_type as PricingRule["actionType"],
      actionValue: r.action_value as number | undefined,
      priority: r.priority as number,
      maxApplicable: r.max_applicable as boolean,
      isActive: r.is_active as boolean,
    }));

    const { data: profile } = await supabase
      .from("client_profiles")
      .select("score, services_count, disputes_lost_count, account_type")
      .eq("user_id", user.id)
      .single();

    const todayStr = getVancouverTodayString();
    const advanceNoticeDays = daysBetween(todayStr, serviceDate);

    // Fix (auditoría externa, hallazgo confirmado): ver src/lib/zone-demand.ts.
    // Acá SÍ hay fecha de servicio elegida (serviceDate) -- se usa la
    // ocupación real de ESE día para la zona, no el promedio rolling.
    const zoneDemand = await getZoneDemand(supabase, quote.zone, serviceDate);

    const ruleContextExtra: Partial<RuleContext> = {
      serviceSubtype: quote.service_subtype,
      clientScore: profile?.score ?? quote.client_score ?? 50,
      servicesCount: profile?.services_count ?? 0,
      disputesLostCount: profile?.disputes_lost_count ?? 0,
      accountType: profile?.account_type ?? "b2c",
      clientType: deriveClientType(profile?.services_count ?? 0, profile?.score ?? quote.client_score ?? 50),
      zoneDemand,
      organicLoad: deriveOrganicLoad(quote.pets_count, quote.pets_type, quote.residents),
      advanceNoticeDays,
    };

    // Recalcular precio con los nuevos parámetros de día. addon_zones_charge
    // ya fue validado y persistido al crear la quote (v8.3 E4, D.7) — la
    // selección de zonas add-on no cambia por elegir fecha, así que se
    // reutiliza el monto guardado en vez de volver a resolverlo.
    const breakdown = calculatePrice(
      quote.service_type as ServiceType,
      quote.square_feet,
      quote.pets_count,
      quote.pets_type,
      quote.residents,
      quote.days_since_cleaning,
      quote.zone,
      dayOfWeek,
      isPreferredDay,
      targetHourlyRate,
      hheTable,
      quote.addon_zones_charge ?? 0,
      rules,
      ruleContextExtra
    );

    // Las reglas de bloqueo no deberían activarse en recálculo si la quote ya fue aceptada,
    // pero si lo hacen, calculatePrice ya deja el subtotal/total sin el ajuste
    // de reglas (ver src/lib/rules.ts applyPricingRules: blocked corta antes
    // de acumular adjustment) -- solo reportamos la discrepancia.
    if (breakdown.blocked) {
      console.warn("Quote recalculate blocked by rule after date selection:", breakdown.blockReason);
    }

    // breakdown.subtotal/gst/pst/total ya incluyen el ajuste real del motor
    // de reglas, calculado en centavos enteros (fix auditoría externa,
    // hallazgos #1 y #2).
    const subtotalAfterRules = breakdown.subtotal;
    const gst = breakdown.gst;
    const pst = breakdown.pst;
    const total = breakdown.total;
    const holdAmount = calculateHold(
      quote.service_type as ServiceType,
      quote.square_feet,
      total,
      targetHourlyRate
    );

    const freeze = new Date(Date.now() + 10 * 60 * 1000);

    const { data: updatedQuote, error: updateError } = await supabase
      .from("quotes")
      .update({
        day_of_week: dayOfWeek,
        is_preferred_day: isPreferredDay,
        logistics_surcharge: breakdown.logisticsSurcharge,
        addon_zones_charge: breakdown.addonZonesCharge,
        rule_adjustment: breakdown.ruleAdjustment,
        applied_rules: breakdown.appliedRules,
        // Fix CRÍTICO (auditoría externa de integridad financiera,
        // 2026-08-02): quotes.subtotal y quotes.hold_amount son INTEGER en
        // dólares (sin decimales); subtotalAfterRules puede traer fracción
        // de dólar. Redondeo explícito aquí, mismo criterio que
        // src/app/api/quote/route.ts -- ver comentario allá y migración 311
        // (COMMENT ON COLUMN) para el detalle completo.
        subtotal: Math.round(subtotalAfterRules),
        gst,
        pst,
        total,
        hold_amount: Math.round(holdAmount),
        price_frozen_until: freeze.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .select(QUOTE_CLIENT_COLUMNS)
      .single();

    if (updateError) {
      console.error("Quote recalculate update error:", updateError);
      console.error("updateError:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      {
        quote: updatedQuote,
        dayOfWeek,
        isPreferredDay,
        logisticsSurcharge: breakdown.logisticsSurcharge,
        total,
        holdAmount,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

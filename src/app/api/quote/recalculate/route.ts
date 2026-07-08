import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  calculatePrice,
  calculateHold,
  getTargetHourlyRate,
  getCurrentHHETable,
  ServiceType,
  GST_RATE,
  PST_RATE,
} from "@/lib/pricing";
import { applyPricingRules, type PricingRule, type RuleContext } from "@/lib/rules";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

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

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * Recalcula el precio de una quote cuando el cliente elige fecha de servicio.
 * El precio original se congela en el wizard; este endpoint aplica el recargo
 * logístico por fin de semana / día no preferencial de forma server-side.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
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
      .select("*")
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

    // Calcular día de la semana y preferencia según la fecha elegida
    const selectedDate = new Date(`${serviceDate}T00:00:00`);
    if (isNaN(selectedDate.getTime())) {
      return NextResponse.json({ error: "Invalid serviceDate" }, { status: 400 });
    }

    const dayOfWeek = selectedDate.getDay();
    const isPreferredDay = dayOfWeek >= 1 && dayOfWeek <= 5; // lun-vie preferidos

    // Leer tarifa objetivo vigente
    const targetHourlyRate = await getTargetHourlyRate(supabase);
    const hheTable = await getCurrentHHETable(supabase);

    // Recalcular precio con los nuevos parámetros de día
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
      hheTable
    );

    // Reaplicar motor de reglas con el nuevo contexto de día
    const { data: rulesData } = await supabase
      .from("pricing_rules")
      .select("id, name, description, condition_json, action_type, action_value, priority, max_applicable, is_active")
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

    const todayStr = new Date().toISOString().split("T")[0];
    const advanceNoticeDays = daysBetween(todayStr, serviceDate);

    const ruleContext: RuleContext = {
      zone: quote.zone,
      dayOfWeek,
      isPreferredDay,
      serviceType: quote.service_type,
      serviceSubtype: quote.service_subtype,
      squareFeet: quote.square_feet,
      clientScore: profile?.score ?? quote.client_score ?? 50,
      servicesCount: profile?.services_count ?? 0,
      disputesLostCount: profile?.disputes_lost_count ?? 0,
      accountType: profile?.account_type ?? "b2c",
      clientType: deriveClientType(profile?.services_count ?? 0, profile?.score ?? quote.client_score ?? 50),
      zoneDemand: 50,
      organicLoad: deriveOrganicLoad(quote.pets_count, quote.pets_type, quote.residents),
      daysSinceCleaning: quote.days_since_cleaning,
      advanceNoticeDays,
    };

    const ruleResult = applyPricingRules(rules, ruleContext, breakdown.basePrice, breakdown.subtotal);

    // Las reglas de bloqueo no deberían activarse en recálculo si la quote ya fue aceptada,
    // pero si lo hacen, mantenemos el precio original y reportamos la discrepancia.
    if (ruleResult.blocked) {
      console.warn("Quote recalculate blocked by rule after date selection:", ruleResult.blockReason);
    }

    const subtotalAfterRules = ruleResult.blocked
      ? breakdown.subtotal
      : Math.round(Math.max(0, breakdown.subtotal + ruleResult.adjustment));
    const gst = Math.round(subtotalAfterRules * GST_RATE * 100) / 100;
    const pst = Math.round(subtotalAfterRules * PST_RATE * 100) / 100;
    const total = Math.round((subtotalAfterRules + gst + pst) * 100) / 100;
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
        rule_adjustment: ruleResult.blocked ? 0 : ruleResult.adjustment,
        applied_rules: ruleResult.blocked ? [] : ruleResult.appliedRules,
        subtotal: subtotalAfterRules,
        gst,
        pst,
        total,
        hold_amount: holdAmount,
        price_frozen_until: freeze.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError) {
      console.error("Quote recalculate update error:", updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
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
    console.error("Quote recalculate error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

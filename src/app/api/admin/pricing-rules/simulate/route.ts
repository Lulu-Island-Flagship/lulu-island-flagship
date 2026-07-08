import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";
import {
  simulatePricingRules,
  type PricingRule,
  type SimulationCase,
  type RuleContext,
} from "@/lib/rules";

function deriveClientType(servicesCount: number, clientScore: number): RuleContext["clientType"] {
  if (servicesCount === 0) return "new";
  if (servicesCount >= 10 && clientScore > 80) return "elite";
  return "returning";
}

function deriveOrganicLoad(
  petsCount: number,
  petsType: string,
  residents: number
): RuleContext["organicLoad"] {
  if (petsCount >= 3 || residents >= 5) return "high";
  const hasLongHair =
    petsType?.toLowerCase().includes("long") ||
    petsType?.toLowerCase().includes("largo") ||
    petsType?.toLowerCase().includes("multiple");
  if (hasLongHair || residents >= 3) return "medium";
  return "low";
}

function enrichContext(ctx: Omit<RuleContext, "clientType" | "zoneDemand" | "organicLoad" | "daysSinceCleaning" | "advanceNoticeDays" | "disputesLostCount"> & Partial<RuleContext>): RuleContext {
  const servicesCount = ctx.servicesCount ?? 0;
  const clientScore = ctx.clientScore ?? 50;
  const petsCount = (ctx as unknown as { petsCount?: number }).petsCount ?? 0;
  const petsType = (ctx as unknown as { petsType?: string }).petsType ?? "none";
  const residents = (ctx as unknown as { residents?: number }).residents ?? 2;
  const daysSinceCleaning = (ctx as unknown as { daysSinceCleaning?: number }).daysSinceCleaning ?? 30;
  return {
    ...ctx,
    disputesLostCount: ctx.disputesLostCount ?? 0,
    clientType: deriveClientType(servicesCount, clientScore),
    zoneDemand: ctx.zoneDemand ?? 50,
    organicLoad: ctx.organicLoad ?? deriveOrganicLoad(petsCount, petsType, residents),
    daysSinceCleaning,
    advanceNoticeDays: ctx.advanceNoticeDays ?? 0,
  } as RuleContext;
}

const DEFAULT_SYNTHETIC_CASES: SimulationCase[] = [
  {
    name: "Elite client, deep clean, large home",
    context: enrichContext({
      zone: "Richmond",
      dayOfWeek: 3,
      isPreferredDay: true,
      serviceType: "deep",
      serviceSubtype: "first_time",
      squareFeet: 3000,
      clientScore: 95,
      servicesCount: 15,
      accountType: "b2c",
      petsCount: 0,
      petsType: "none",
      residents: 2,
      daysSinceCleaning: 30,
    }),
    basePrice: 280,
    subtotal: 280,
  },
  {
    name: "Negative score, first booking",
    context: enrichContext({
      zone: "Vancouver",
      dayOfWeek: 5,
      isPreferredDay: false,
      serviceType: "regular",
      serviceSubtype: "regular",
      squareFeet: 900,
      clientScore: -10,
      servicesCount: 0,
      accountType: "b2c",
      petsCount: 1,
      petsType: "short_hair",
      residents: 2,
      daysSinceCleaning: 90,
    }),
    basePrice: 105,
    subtotal: 105,
  },
  {
    name: "North Vancouver weekend",
    context: enrichContext({
      zone: "North Vancouver",
      dayOfWeek: 0,
      isPreferredDay: false,
      serviceType: "regular",
      serviceSubtype: "regular",
      squareFeet: 1400,
      clientScore: 50,
      servicesCount: 2,
      accountType: "b2c",
      petsCount: 1,
      petsType: "long_hair",
      residents: 3,
      daysSinceCleaning: 120,
    }),
    basePrice: 140,
    subtotal: 140,
  },
  {
    name: "West Vancouver Airbnb",
    context: enrichContext({
      zone: "West Vancouver",
      dayOfWeek: 6,
      isPreferredDay: true,
      serviceType: "regular",
      serviceSubtype: "airbnb",
      squareFeet: 1200,
      clientScore: 60,
      servicesCount: 5,
      accountType: "b2c",
      petsCount: 0,
      petsType: "none",
      residents: 1,
      daysSinceCleaning: 20,
    }),
    basePrice: 120,
    subtotal: 120,
  },
  {
    name: "Post-construction commercial",
    context: enrichContext({
      zone: "UBC",
      dayOfWeek: 2,
      isPreferredDay: true,
      serviceType: "post_construction",
      serviceSubtype: "post_construction",
      squareFeet: 4000,
      clientScore: 40,
      servicesCount: 1,
      accountType: "b2b",
      petsCount: 0,
      petsType: "none",
      residents: 2,
      daysSinceCleaning: 180,
    }),
    basePrice: 560,
    subtotal: 560,
  },
];

function isValidRuleCandidate(candidate: unknown): candidate is PricingRule {
  if (!candidate || typeof candidate !== "object") return false;
  const r = candidate as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.conditionJson === "object" &&
    typeof r.actionType === "string" &&
    typeof r.priority === "number" &&
    typeof r.maxApplicable === "boolean" &&
    typeof r.isActive === "boolean"
  );
}

function normalizeRuleFromBody(raw: Record<string, unknown>): PricingRule {
  return {
    id: String(raw.id || ""),
    name: String(raw.name || ""),
    description: raw.description ? String(raw.description) : undefined,
    conditionJson: (raw.conditionJson as PricingRule["conditionJson"]) || { field: "zone", op: "==", value: "" },
    actionType: String(raw.actionType) as PricingRule["actionType"],
    actionValue: raw.actionValue !== undefined && raw.actionValue !== null ? Number(raw.actionValue) : undefined,
    priority: Number(raw.priority || 0),
    maxApplicable: Boolean(raw.maxApplicable),
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
  };
}

function quoteToCase(
  quote: Record<string, unknown>,
  profileMap: Map<string, { servicesCount: number; accountType: string; disputesLostCount: number }>
): SimulationCase | null {
  const userId = quote.user_id as string | undefined;
  const profile = userId ? profileMap.get(userId) : undefined;
  const serviceType = (quote.service_type as string) || "regular";
  const serviceSubtype = (quote.service_subtype as string) || "regular";
  const zone = (quote.zone as string) || "Richmond";
  const squareFeet = Number(quote.square_feet || 0);
  if (!squareFeet) return null;

  const context = enrichContext({
    zone,
    dayOfWeek: Number(quote.day_of_week ?? 1),
    isPreferredDay: Boolean(quote.is_preferred_day ?? true),
    serviceType,
    serviceSubtype,
    squareFeet,
    clientScore: Number(quote.client_score ?? 50),
    servicesCount: profile?.servicesCount ?? 0,
    accountType: profile?.accountType ?? "b2c",
    disputesLostCount: profile?.disputesLostCount ?? 0,
    petsCount: Number(quote.pets_count ?? 0),
    petsType: String(quote.pets_type ?? "none"),
    residents: Number(quote.residents ?? 2),
    daysSinceCleaning: Number(quote.days_since_cleaning ?? 30),
  });

  return {
    name: `Historical quote — ${serviceSubtype} in ${zone} (${squareFeet} ft²)`,
    context,
    basePrice: Number(quote.base_price || 0),
    subtotal: Number(quote.subtotal || 0),
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const shadow = body.shadow !== false;
    const candidateRulesInput = Array.isArray(body.rules) ? body.rules.filter(isValidRuleCandidate) : [];
    const userSyntheticCases = Array.isArray(body.syntheticCases)
      ? (body.syntheticCases as SimulationCase[])
      : [];

    // Cargar reglas activas actuales (baseline) y reglas candidatas
    const { data: activeRulesRows, error: activeError } = await auth.supabase
      .from("pricing_rules")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: false });

    if (activeError) {
      console.error("Active rules fetch error:", activeError);
      return NextResponse.json({ error: activeError.message }, { status: 500 });
    }

    const activeRules: PricingRule[] = (activeRulesRows || []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      name: String(r.name || ""),
      description: r.description ? String(r.description) : undefined,
      conditionJson: (r.condition_json as PricingRule["conditionJson"]) || { field: "zone", op: "==", value: "" },
      actionType: String(r.action_type) as PricingRule["actionType"],
      actionValue: r.action_value !== undefined && r.action_value !== null ? Number(r.action_value) : undefined,
      priority: Number(r.priority || 0),
      maxApplicable: Boolean(r.max_applicable),
      isActive: true,
    }));

    const candidateRules: PricingRule[] =
      candidateRulesInput.length > 0 ? candidateRulesInput.map(normalizeRuleFromBody) : activeRules;

    // Cargar últimas 100 quotes anonimizadas
    const { data: quotesRows, error: quotesError } = await auth.supabase
      .from("quotes")
      .select(
        "user_id, service_type, service_subtype, zone, square_feet, day_of_week, is_preferred_day, client_score, base_price, subtotal, pets_count, pets_type, residents, days_since_cleaning"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (quotesError) {
      console.error("Quotes fetch error:", quotesError);
      return NextResponse.json({ error: quotesError.message }, { status: 500 });
    }

    const userIds = Array.from(
      new Set((quotesRows || []).map((q: Record<string, unknown>) => q.user_id).filter(Boolean))
    ) as string[];

    let profileMap = new Map<string, { servicesCount: number; accountType: string; disputesLostCount: number }>();
    if (userIds.length > 0) {
      const { data: profilesRows, error: profilesError } = await auth.supabase
        .from("client_profiles")
        .select("user_id, services_count, account_type, disputes_lost_count")
        .in("user_id", userIds);

      if (profilesError) {
        console.error("Client profiles fetch error:", profilesError);
      } else {
        profileMap = new Map(
          (profilesRows || []).map((p: Record<string, unknown>) => [
            String(p.user_id),
            {
              servicesCount: Number(p.services_count || 0),
              accountType: String(p.account_type || "b2c"),
              disputesLostCount: Number(p.disputes_lost_count || 0),
            },
          ])
        );
      }
    }

    const quoteCases = (quotesRows || [])
      .map((q: Record<string, unknown>) => quoteToCase(q, profileMap))
      .filter((c): c is SimulationCase => c !== null);

    const syntheticCases = userSyntheticCases.length > 0 ? userSyntheticCases : DEFAULT_SYNTHETIC_CASES;
    const allCases = [...quoteCases, ...syntheticCases];

    // Ejecutar simulación con reglas candidatas
    const candidateResults = simulatePricingRules(candidateRules, allCases);

    // Si shadow, también ejecutar contra reglas activas actuales para comparar
    let baselineResults: ReturnType<typeof simulatePricingRules> | null = null;
    if (shadow && candidateRulesInput.length > 0) {
      baselineResults = simulatePricingRules(activeRules, allCases);
    }

    const results = candidateResults.map((r, i) => {
      const base = {
        name: r.name,
        context: allCases[i].context,
        basePrice: allCases[i].basePrice,
        subtotal: allCases[i].subtotal,
        finalSubtotal: r.finalSubtotal,
        adjustment: r.result.adjustment,
        appliedRules: r.result.appliedRules,
        blocked: r.result.blocked,
        blockReason: r.result.blockReason,
        flagged: r.result.flagged,
        flagReason: r.result.flagReason,
      };

      if (baselineResults) {
        const baseline = baselineResults[i];
        return {
          ...base,
          baseline: {
            finalSubtotal: baseline.finalSubtotal,
            adjustment: baseline.result.adjustment,
            appliedRules: baseline.result.appliedRules,
            blocked: baseline.result.blocked,
            flagged: baseline.result.flagged,
          },
          diff: r.finalSubtotal - baseline.finalSubtotal,
        };
      }

      return base;
    });

    return NextResponse.json(
      {
        mode: shadow ? "shadow" : "production",
        candidateRulesCount: candidateRules.length,
        baselineRulesCount: activeRules.length,
        quoteCasesCount: quoteCases.length,
        syntheticCasesCount: syntheticCases.length,
        results,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Pricing rules simulate error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

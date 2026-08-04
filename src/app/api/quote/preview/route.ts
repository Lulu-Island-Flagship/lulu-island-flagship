import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  calculatePrice,
  calculateHold,
  getTargetHourlyRate,
  getCurrentHHETable,
  ServiceType,
  MARGIN_FLOOR_PERCENT,
  ACTIVE_ZONES,
  SERVICE_CATEGORIES,
  SERVICE_SUBTYPES,
  PET_TYPES,
  type ServiceCategory,
} from "@/lib/pricing";
import { type RuleContext, type PricingRule } from "@/lib/rules";
import { getZoneDemand } from "@/lib/zone-demand";
import { calculateAddonZonesCharge } from "@/lib/pricing";
import { fetchAddonZoneOptions } from "@/lib/addon-zones";
import type { QuoteInput, QuoteData } from "@/types";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

const MIN_SQUARE_FEET = 300;
const MAX_SQUARE_FEET = 10000;

function validatePreviewInputs(
  input: QuoteInput
): { valid: false; error: string } | { valid: true } {
  const {
    serviceCategory,
    serviceSubtype,
    serviceType,
    bedrooms,
    bathrooms,
    squareFeet,
    petsCount,
    petsType,
    residents,
    daysSinceCleaning,
    address,
    zone,
    postalCode,
  } = input;

  if (!serviceCategory || !SERVICE_CATEGORIES.some((c) => c.key === serviceCategory)) {
    return { valid: false, error: "Invalid service category" };
  }

  const validSubtypes = SERVICE_SUBTYPES[serviceCategory as ServiceCategory].map((s) => s.key);
  if (!serviceSubtype || !validSubtypes.some((s) => s === serviceSubtype)) {
    return { valid: false, error: `Invalid service subtype for category ${serviceCategory}` };
  }

  const mappedType = SERVICE_SUBTYPES[serviceCategory as ServiceCategory].find(
    (s) => s.key === serviceSubtype
  )?.mapsTo;
  if (!serviceType || serviceType !== mappedType) {
    return { valid: false, error: "Service type does not match subtype mapping" };
  }

  if (
    bedrooms === undefined ||
    !Number.isInteger(bedrooms) ||
    bedrooms < 0 ||
    bathrooms === undefined ||
    !Number.isInteger(bathrooms) ||
    bathrooms < 0
  ) {
    return { valid: false, error: "Bedrooms and bathrooms must be non-negative integers" };
  }

  if (
    squareFeet === undefined ||
    !Number.isInteger(squareFeet) ||
    squareFeet < MIN_SQUARE_FEET ||
    squareFeet > MAX_SQUARE_FEET
  ) {
    return { valid: false, error: `Square footage must be an integer between ${MIN_SQUARE_FEET} and ${MAX_SQUARE_FEET}` };
  }

  if (
    petsCount === undefined ||
    !Number.isInteger(petsCount) ||
    petsCount < 0 ||
    !petsType ||
    !PET_TYPES.includes(petsType as (typeof PET_TYPES)[number])
  ) {
    return { valid: false, error: "Invalid pet information" };
  }

  if (residents === undefined || !Number.isInteger(residents) || residents < 1) {
    return { valid: false, error: "Residents must be a positive integer" };
  }

  if (daysSinceCleaning === undefined || !Number.isInteger(daysSinceCleaning) || daysSinceCleaning < 0) {
    return { valid: false, error: "Invalid recency value" };
  }

  if (!address || address.trim().length < 5) {
    return { valid: false, error: "Address is required" };
  }

  if (!zone || !ACTIVE_ZONES.some((z) => z.name === zone)) {
    return { valid: false, error: "Invalid or unsupported service zone" };
  }

  if (postalCode) {
    const normalizedPostal = postalCode.replace(/\s/g, "").toUpperCase();
    if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(normalizedPostal)) {
      return { valid: false, error: "Invalid Canadian postal code" };
    }
  }

  if (input.dayOfWeek !== undefined && (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
    return { valid: false, error: "dayOfWeek must be an integer between 0 and 6" };
  }

  if (input.isPreferredDay !== undefined && typeof input.isPreferredDay !== "boolean") {
    return { valid: false, error: "isPreferredDay must be a boolean" };
  }

  return { valid: true };
}

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

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
      },
    },
  });
}

async function getClientProfile(supabase: ReturnType<typeof getSupabaseClient>, userId: string) {
  const { data: existing } = await supabase
    .from("client_profiles")
    .select("score, services_count, account_type")
    .eq("user_id", userId)
    .single();

  if (existing) {
    return {
      score: Number(existing.score ?? 50),
      servicesCount: Number(existing.services_count ?? 0),
      disputesLostCount: Number((existing as { disputes_lost_count?: number }).disputes_lost_count ?? 0),
      accountType: String(existing.account_type || "b2c"),
    };
  }

  return { score: 50, servicesCount: 0, disputesLostCount: 0, accountType: "b2c" };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user;

    const body = await request.json();
    const rawInput = body as QuoteInput;

    const validation = validatePreviewInputs(rawInput);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      serviceCategory,
      serviceSubtype,
      serviceType,
      squareFeet,
      petsCount,
      petsType,
      residents,
      daysSinceCleaning,
      zone,
      dayOfWeek,
      isPreferredDay,
    } = rawInput;

    const profile = user ? await getClientProfile(supabase, user.id) : { score: 50, servicesCount: 0, disputesLostCount: 0, accountType: "b2c" };

    // Servicios comerciales se tratan como B2B aunque el perfil diga B2C
    let accountType = profile.accountType;
    if (serviceCategory === "commercial" && accountType === "b2c") {
      accountType = "b2b";
    }

    const targetHourlyRate = await getTargetHourlyRate(supabase);
    const hheTable = await getCurrentHHETable(supabase);

    // v8.3 E4 (D.7): zonas add-on (ej. Garaje) que el admin agregó y marcó
    // como cobrables. Se recalcula siempre contra la lista real, nunca se
    // confía en un monto enviado por el cliente.
    const availableAddonZones = await fetchAddonZoneOptions(supabase, serviceSubtype!);
    const addonZonesCharge = calculateAddonZonesCharge(
      availableAddonZones,
      rawInput.addonZones || [],
      targetHourlyRate
    );

    // Motor de reglas headless (src/lib/rules.ts): reglas + contexto se
    // arman ANTES de llamar a calculatePrice, que ahora invoca
    // applyPricingRules() internamente (fix auditoría externa, hallazgo #1).
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

    // Fix (auditoría externa, hallazgo confirmado): ver src/lib/zone-demand.ts.
    // Este preview no tiene fecha de servicio todavía -- promedio rolling de
    // 14 días para la zona.
    const zoneDemand = await getZoneDemand(supabase, zone!, null);

    const ruleContextExtra: Partial<RuleContext> = {
      serviceSubtype: serviceSubtype!,
      clientScore: profile.score,
      servicesCount: profile.servicesCount,
      disputesLostCount: profile.disputesLostCount,
      accountType,
      clientType: deriveClientType(profile.servicesCount, profile.score),
      zoneDemand,
      organicLoad: deriveOrganicLoad(petsCount, petsType, residents),
      advanceNoticeDays: 0,
    };

    // Fix (auditoría 2026-07-31, hallazgo #5): ver el mismo fix y
    // explicación en /api/quote/route.ts -- se usa un lunes neutro
    // (dayOfWeek ?? 1) + isPreferredDay=true por defecto para que ninguna
    // regla de fin de semana dispare por accidente según el día real de HOY
    // del servidor.
    const baseBreakdown = calculatePrice(
      serviceType as ServiceType,
      squareFeet,
      petsCount,
      petsType,
      residents,
      daysSinceCleaning,
      zone,
      dayOfWeek,
      isPreferredDay,
      targetHourlyRate,
      hheTable,
      addonZonesCharge,
      rules,
      ruleContextExtra
    );

    // baseBreakdown.subtotal/gst/pst/total ya incluyen el ajuste real del
    // motor de reglas (fix auditoría externa, hallazgos #1 y #2).
    const subtotalAfterRules = baseBreakdown.subtotal;
    const gst = baseBreakdown.gst;
    const pst = baseBreakdown.pst;
    const totalAfterRules = baseBreakdown.total;
    const holdAmount = calculateHold(serviceType as ServiceType, squareFeet, totalAfterRules, targetHourlyRate);

    const freeze = new Date(Date.now() + 10 * 60 * 1000);

    const estimatedLaborCost = baseBreakdown.estimatedLaborCost;
    const marginContribution = subtotalAfterRules > 0 ? (subtotalAfterRules - estimatedLaborCost) / subtotalAfterRules : 0;
    const marginBelowFloor = marginContribution < MARGIN_FLOOR_PERCENT;

    // baseBreakdown.adminReviewRequired ya incluye baseBreakdown.flagged
    // (motor de reglas); marginBelowFloor cubre el margen post-reglas.
    let adminReviewRequired = baseBreakdown.adminReviewRequired || marginBelowFloor;
    const adminReviewReasons: string[] = [];
    if (baseBreakdown.adminReviewReason) adminReviewReasons.push(baseBreakdown.adminReviewReason);
    if (marginBelowFloor) {
      adminReviewReasons.push(
        `Margen de contribución ${(marginContribution * 100).toFixed(1)}% por debajo del ${(
          MARGIN_FLOOR_PERCENT * 100
        ).toFixed(0)}% después de reglas`
      );
    }
    if (accountType === "b2b" || accountType === "government") {
      adminReviewRequired = true;
      adminReviewReasons.push(
        "B2B / Government account requires manual onboarding, PO process, and Net-30 setup before booking"
      );
    }

    const quote: QuoteData = {
      ...rawInput,
      basePrice: baseBreakdown.basePrice,
      organicMultiplier: baseBreakdown.organicMultiplier,
      organicAdjustment: baseBreakdown.organicAdjustment,
      recencyMultiplier: baseBreakdown.recencyMultiplier,
      recencyAdjustment: baseBreakdown.recencyAdjustment,
      zoneSurcharge: baseBreakdown.zoneSurcharge,
      logisticsSurcharge: baseBreakdown.logisticsSurcharge,
      addonZonesCharge: baseBreakdown.addonZonesCharge,
      ruleAdjustment: baseBreakdown.ruleAdjustment,
      appliedRules: baseBreakdown.appliedRules,
      subtotal: subtotalAfterRules,
      gst,
      pst,
      total: totalAfterRules,
      holdAmount,
      estimatedLaborCost,
      estimatedMarginContribution: marginContribution,
      adminReviewRequired,
      adminReviewReason: adminReviewReasons.join("; ") || undefined,
      priceFrozenUntil: freeze.toISOString(),
      status: "pending",
      consentTc: false,
      consentPipa: false,
      pipaAltRequiresAudit: true,
      consentMarketing: false,
      consentPhotoMarketing: false,
      tcVersion: "v1.0",
      pipaVersion: "v1.0",
      marketingVersion: "v1.0",
      photoMarketingVersion: "v1.0",
      clientScore: profile.score,
    };

    return NextResponse.json(
      {
        quote,
        serverCalculated: true,
        appliedRules: baseBreakdown.appliedRules,
        adminReviewRequired,
        adminReviewReason: adminReviewReasons.join("; ") || undefined,
        accountType,
        b2bReviewRequired: accountType === "b2b" || accountType === "government",
        blocked: baseBreakdown.blocked,
        blockReason: baseBreakdown.blockReason,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

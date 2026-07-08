import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  calculatePrice,
  calculateHold,
  getTargetHourlyRate,
  getCurrentHHETable,
  CONSENT_VERSIONS,
  ServiceType,
  GST_RATE,
  PST_RATE,
  MARGIN_FLOOR_PERCENT,
} from "@/lib/pricing";
import { applyPricingRules, type RuleContext, type PricingRule } from "@/lib/rules";
import type { QuoteInput } from "@/types";
import { geocodeAddress } from "@/lib/geocode";
import { calculateClientScore } from "@/lib/scoring";
import {
  ACTIVE_ZONES,
  SERVICE_CATEGORIES,
  SERVICE_SUBTYPES,
  PET_TYPES,
  type ServiceCategory,
} from "@/lib/pricing";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

const MIN_SQUARE_FEET = 300;
const MAX_SQUARE_FEET = 10000;

function validateQuoteInputs(
  input: QuoteInput & { consentTc?: boolean; consentPipa?: boolean; consentMarketing?: boolean }
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
    consentTc,
    consentPipa,
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
    !PET_TYPES.includes(petsType as typeof PET_TYPES[number])
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

  const normalizedPostal = postalCode?.replace(/\s/g, "").toUpperCase() || "";
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(normalizedPostal)) {
    return { valid: false, error: "Invalid Canadian postal code" };
  }

  if (consentTc !== true) {
    return { valid: false, error: "Terms & Conditions consent is required" };
  }

  if (consentPipa !== undefined && typeof consentPipa !== "boolean") {
    return { valid: false, error: "consentPipa must be a boolean" };
  }

  if (input.dayOfWeek !== undefined && (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
    return { valid: false, error: "dayOfWeek must be an integer between 0 and 6" };
  }

  if (input.isPreferredDay !== undefined && typeof input.isPreferredDay !== "boolean") {
    return { valid: false, error: "isPreferredDay must be a boolean" };
  }

  if (input.consentMarketing !== undefined && typeof input.consentMarketing !== "boolean") {
    return { valid: false, error: "consentMarketing must be a boolean" };
  }

  return { valid: true };
}

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
    petsType.toLowerCase().includes("long") ||
    petsType.toLowerCase().includes("largo") ||
    petsType.toLowerCase().includes("multiple");
  if (hasLongHair || residents >= 3) return "medium";
  return "low";
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
 * Servicio role key para operaciones que no deben depender de RLS del usuario
 * (crear/actualizar su propio client_profile está permitido por RLS, así que
 * en teoría no se necesita; se deja comentado para evitar secret leaks).
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const clientIp = getClientIp(request);

    // Autenticación obligatoria
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limiting por usuario autenticado (evita bloquear hogares compartidos por IP)
    const { data: rateLimitData, error: rateLimitError } = await supabase.rpc("check_rate_limit", {
      p_ip_address: user.id,
      p_max_requests: 30,
    });
    if (rateLimitError) {
      console.error("Rate limit check error:", rateLimitError);
    } else if (rateLimitData && !rateLimitData[0]?.allowed) {
      const resetAt = rateLimitData[0]?.reset_at;
      return NextResponse.json(
        { error: "Rate limit exceeded. Maximum 30 quotes per 24 hours." },
        {
          status: 429,
          headers: { "X-RateLimit-Reset": resetAt ? String(new Date(resetAt).getTime()) : "" },
        }
      );
    }

    // Solo aceptamos los inputs brutos del cotizador. NUNCA precios calculados.
    const body = await request.json();
    const rawInput = body as QuoteInput & {
      consentTc?: boolean;
      consentPipa?: boolean;
      consentMarketing?: boolean;
    };

    const validation = validateQuoteInputs(rawInput);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

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
      dayOfWeek,
      isPreferredDay,
      consentTc,
      consentPipa,
      consentMarketing,
      consentPhotoMarketing,
      purchaseOrder,
    } = rawInput;

    // Obtener o crear perfil de cliente para score y tipo de cuenta
    let clientProfile = await getOrCreateClientProfile(supabase, user.id);

    // Actualizar preferencia de consentimiento de fotos marketing si el cliente la proporcionó
    if (clientProfile.id && consentPhotoMarketing !== undefined) {
      const { data: updatedProfile, error: consentUpdateError } = await supabase
        .from("client_profiles")
        .update({
          consent_photo_marketing: consentPhotoMarketing,
          photo_marketing_version: CONSENT_VERSIONS.photoMarketing,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientProfile.id)
        .select()
        .single();

      if (!consentUpdateError && updatedProfile) {
        clientProfile = updatedProfile;
      } else {
        console.error("Failed to update client photo marketing consent:", consentUpdateError);
      }
    }

    // Calcular score progresivo server-side y persistirlo
    // Importante: solo las disputas PERDIDAS penalizan (-25), no cualquier disputa.
    const computedScore = calculateClientScore({
      servicesCount: clientProfile.services_count || 0,
      disputesLostCount: clientProfile.disputes_lost_count || 0,
      noShowCount: clientProfile.no_show_count || 0,
    });

    if (computedScore !== clientProfile.score && clientProfile.id) {
      const { data: updatedProfile, error: scoreUpdateError } = await supabase
        .from("client_profiles")
        .update({ score: computedScore, updated_at: new Date().toISOString() })
        .eq("id", clientProfile.id)
        .select()
        .single();

      if (!scoreUpdateError && updatedProfile) {
        clientProfile = updatedProfile;
      } else {
        console.error("Failed to update client score:", scoreUpdateError);
      }
    }

    let accountType = clientProfile.account_type || "b2c";

    // Bifurcación B2B vs B2C: servicios comerciales cambian el perfil a B2B
    // y requieren revisión administrativa previa (no se permite reserva online directa).
    const isCommercialCategory = serviceCategory === "commercial";
    if (isCommercialCategory && accountType === "b2c" && clientProfile.id) {
      const { data: updatedB2bProfile, error: b2bUpdateError } = await supabase
        .from("client_profiles")
        .update({ account_type: "b2b", updated_at: new Date().toISOString() })
        .eq("id", clientProfile.id)
        .select()
        .single();

      if (!b2bUpdateError && updatedB2bProfile) {
        clientProfile = updatedB2bProfile;
        accountType = "b2b";
      } else {
        console.error("Failed to update account type to b2b:", b2bUpdateError);
      }
    }

    // Bloqueo por score muy bajo (regla de negocio dura)
    if (clientProfile.score < 0) {
      return NextResponse.json(
        {
          error:
            "This account requires manual review before booking. Please contact support.",
          code: "BLOCKED_LOW_SCORE",
        },
        { status: 403 }
      );
    }

    // Leer tarifa objetivo vigente (editable por admin)
    const targetHourlyRate = await getTargetHourlyRate(supabase);
    // Leer tabla HHE vigente (20 celdas editables por admin)
    const hheTable = await getCurrentHHETable(supabase);

    // Calcular precio base en servidor
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
      hheTable
    );

    // Aplicar motor de reglas headless
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

    const ruleContext: RuleContext = {
      zone: zone!,
      dayOfWeek: dayOfWeek ?? new Date().getDay(),
      isPreferredDay: isPreferredDay ?? true,
      serviceType: serviceType!,
      serviceSubtype: serviceSubtype!,
      squareFeet,
      clientScore: clientProfile.score,
      servicesCount: clientProfile.services_count || 0,
      disputesLostCount: clientProfile.disputes_lost_count || 0,
      accountType,
      clientType: deriveClientType(clientProfile.services_count || 0, clientProfile.score),
      zoneDemand: 50, // placeholder; idealmente calculado desde capacidad real
      organicLoad: deriveOrganicLoad(petsCount, petsType, residents),
      daysSinceCleaning,
      advanceNoticeDays: 0, // se actualiza en /api/quote/recalculate cuando el cliente elige fecha
    };

    const ruleResult = applyPricingRules(rules, ruleContext, baseBreakdown.basePrice, baseBreakdown.subtotal);

    if (ruleResult.blocked) {
      return NextResponse.json(
        {
          error: ruleResult.blockReason || "Quote blocked by pricing rule",
          code: "RULE_BLOCKED",
        },
        { status: 400 }
      );
    }

    // Recalcular totales con ajuste de reglas (subtotal siempre entero para DB)
    const subtotalAfterRules = Math.round(Math.max(0, baseBreakdown.subtotal + ruleResult.adjustment));
    const gst = Math.round(subtotalAfterRules * GST_RATE * 100) / 100;
    const pst = Math.round(subtotalAfterRules * PST_RATE * 100) / 100;
    const totalAfterRules = Math.round((subtotalAfterRules + gst + pst) * 100) / 100;
    const holdAmount = calculateHold(serviceType as ServiceType, squareFeet, totalAfterRules, targetHourlyRate);

    const freeze = new Date(Date.now() + 10 * 60 * 1000);
    const acceptedAt = new Date().toISOString();

    // Geocodificar dirección para geocerca real (no bloquea la cotización si falla)
    const coordinates = await geocodeAddress(address);

    // Margen de contribución con reglas aplicadas
    const estimatedLaborCost = baseBreakdown.estimatedLaborCost;
    const marginContribution =
      subtotalAfterRules > 0 ? (subtotalAfterRules - estimatedLaborCost) / subtotalAfterRules : 0;
    const marginBelowFloor = marginContribution < MARGIN_FLOOR_PERCENT;

    let adminReviewRequired = baseBreakdown.adminReviewRequired || ruleResult.flagged || marginBelowFloor;
    const adminReviewReasons: string[] = [];
    if (baseBreakdown.adminReviewReason) adminReviewReasons.push(baseBreakdown.adminReviewReason);
    if (ruleResult.flagReason) adminReviewReasons.push(ruleResult.flagReason);
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
      if (!purchaseOrder || typeof purchaseOrder !== "string" || purchaseOrder.trim().length === 0) {
        return NextResponse.json(
          { error: "B2B / Government quotes require a Purchase Order (PO) number." },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("quotes")
      .insert({
        user_id: user.id,
        service_category: serviceCategory,
        service_subtype: serviceSubtype,
        service_type: serviceType,
        bedrooms,
        bathrooms,
        square_feet: squareFeet,
        pets_count: petsCount,
        pets_type: petsType,
        residents,
        days_since_cleaning: daysSinceCleaning,
        address,
        zone,
        postal_code: postalCode,
        day_of_week: dayOfWeek,
        is_preferred_day: isPreferredDay,
        address_lat: coordinates?.lat ?? null,
        address_lng: coordinates?.lng ?? null,
        base_price: baseBreakdown.basePrice,
        organic_multiplier: baseBreakdown.organicMultiplier,
        organic_adjustment: baseBreakdown.organicAdjustment,
        recency_multiplier: baseBreakdown.recencyMultiplier,
        recency_adjustment: baseBreakdown.recencyAdjustment,
        zone_surcharge: baseBreakdown.zoneSurcharge,
        logistics_surcharge: baseBreakdown.logisticsSurcharge,
        rule_adjustment: ruleResult.adjustment,
        applied_rules: ruleResult.appliedRules,
        subtotal: subtotalAfterRules,
        gst,
        pst,
        total: totalAfterRules,
        hold_amount: holdAmount,
        estimated_labor_cost: estimatedLaborCost,
        estimated_margin_contribution: marginContribution,
        price_frozen_until: freeze.toISOString(),
        status: "pending",
        admin_review_required: adminReviewRequired,
        admin_review_reason: adminReviewReasons.join("; ") || null,
        consent_tc: consentTc,
        consent_pipa: consentPipa ?? false,
        consent_marketing: consentMarketing,
        consent_photo_marketing: consentPhotoMarketing,
        pipa_alt_requires_audit: consentPipa !== true,
        purchase_order: purchaseOrder || null,
        tc_version: CONSENT_VERSIONS.tc,
        pipa_version: CONSENT_VERSIONS.pipa,
        marketing_version: CONSENT_VERSIONS.marketing,
        photo_marketing_version: CONSENT_VERSIONS.photoMarketing,
        consent_ip: clientIp,
        consent_accepted_at: acceptedAt,
        client_score: clientProfile.score,
      })
      .select()
      .single();

    if (error) {
      console.error("Quote insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        quote: data,
        quoteId: data.id,
        serverCalculated: true,
        appliedRules: ruleResult.appliedRules,
        adminReviewRequired,
        adminReviewReason: adminReviewReasons.join("; ") || undefined,
        accountType,
        b2bReviewRequired: accountType === "b2b" || accountType === "government",
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    console.error("Quote API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET(_request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _request;
  try {
    const supabase = getSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("quotes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quotes: data }, { status: 200 });
  } catch (err: Error | unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function getOrCreateClientProfile(supabase: ReturnType<typeof getSupabaseClient>, userId: string) {
  const { data: existing, error: selectError } = await supabase
    .from("client_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    console.error("Client profile select error:", selectError);
  }

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("client_profiles")
    .insert({ user_id: userId, score: 50 })
    .select()
    .single();

  if (error) {
    console.error("Client profile creation error:", error);
    // Fallback: devolver un perfil sintético para no romper la cotización
    return {
      id: "",
      user_id: userId,
      score: 50,
      services_count: 0,
      disputes_count: 0,
      no_show_count: 0,
      account_type: "b2c",
    };
  }

  return created;
}

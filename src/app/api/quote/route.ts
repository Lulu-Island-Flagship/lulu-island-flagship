
import { NextRequest, NextResponse } from "next/server";
import {
  calculatePrice,
  calculateHold,
  getTargetHourlyRate,
  getCurrentHHETable,
  CONSENT_VERSIONS,
  ServiceType,
  MARGIN_FLOOR_PERCENT,
  computeTaxBreakdown,
  dollarsToCents,
  assertCentsReasonable,
} from "@/lib/pricing";
import { type RuleContext, type PricingRule } from "@/lib/rules";
import { calculateAddonZonesCharge } from "@/lib/pricing";
import { fetchAddonZoneOptions } from "@/lib/addon-zones";
import type { QuoteInput } from "@/types";
import { geocodeAddress } from "@/lib/geocode";
import { calculateClientScore } from "@/lib/scoring";
import { safeErrorResponse } from "@/lib/api-errors";
import { isEligibleForInstallmentPlan, computeInstallmentSplit } from "@/lib/installment-payment";
import { QUOTE_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { isValidPreferredLanguages } from "@/lib/languages";
import { isValidAcquisitionChannel } from "@/lib/acquisition-channel";
import {
  evaluateBookingRiskConsequence,
  normalizeAddressForMatch,
  type RiskTier,
} from "@/lib/property-risk";
import {
  ACTIVE_ZONES,
  SERVICE_CATEGORIES,
  SERVICE_SUBTYPES,
  PET_TYPES,
  type ServiceCategory,
  computePrintedInvoiceCharge,
} from "@/lib/pricing";
import { getZoneDemand } from "@/lib/zone-demand";
// Fix 2026-07-24 (auditoría externa): captureError se usa en
// getOrCreateClientProfile para dejar rastreable en producción el fallo
// silencioso de creación de client_profile (ver comentario junto a esa
// función más abajo).
import { captureError } from "@/lib/observability";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
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

  if (
    (input as QuoteInput).preferredLanguages !== undefined &&
    !isValidPreferredLanguages((input as QuoteInput).preferredLanguages)
  ) {
    return { valid: false, error: "preferredLanguages must be a non-empty list of supported, non-repeated language codes" };
  }

  if (
    (input as QuoteInput).acquisitionChannel !== undefined &&
    !isValidAcquisitionChannel((input as QuoteInput).acquisitionChannel)
  ) {
    return { valid: false, error: "acquisitionChannel must be one of the supported values" };
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
/**
 * Servicio role key para operaciones que no deben depender de RLS del usuario
 * (crear/actualizar su propio client_profile está permitido por RLS, así que
 * en teoría no se necesita; se deja comentado para evitar secret leaks).
 */

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteSupabaseClient();
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
    // Fix (auditoría externa, hallazgo CRÍTICO): antes, si el RPC fallaba, el
    // error solo se logueaba y la petición seguía como si no hubiera límite
    // -- fuerza bruta sin restricción en un fallo de infraestructura. Ahora
    // se falla CERRADO (mismo patrón que /api/staff/resolve-login y
    // /api/recovery/*).
    if (rateLimitError) {
      console.error("Rate limit check error:", rateLimitError);
      return NextResponse.json(
        { error: "Service temporarily unavailable. Try again later." },
        { status: 503 }
      );
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
      preferredLanguages,
      acquisitionChannel,
      printedInvoiceRequested,
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

    // v8.3 M0-F0.4 (B.2.13): idioma(s) de la cuenta, ordenados por prioridad.
    // Ya validado arriba (isValidPreferredLanguages). Sin esto el match de
    // idioma del despacho no tiene dato real que consultar (siempre 'en').
    if (clientProfile.id && preferredLanguages !== undefined) {
      const { data: updatedProfile, error: langUpdateError } = await supabase
        .from("client_profiles")
        .update({
          preferred_languages: preferredLanguages,
          updated_at: new Date().toISOString(),
        })
        .eq("id", clientProfile.id)
        .select()
        .single();

      if (!langUpdateError && updatedProfile) {
        clientProfile = updatedProfile;
      } else {
        console.error("Failed to update client preferred languages:", langUpdateError);
      }
    }

    // v8.3 E6.6: factura impresa opcional (+$2 B2C por correo; B2B/Gov
    // siempre true sin recargo vía trigger, migración 201). Se persiste
    // como preferencia de cuenta (no por-cotización) para que futuras
    // reservas del mismo cliente no tengan que repetirlo.
    if (clientProfile.id && printedInvoiceRequested !== undefined) {
      const { data: updatedProfile, error: printedInvoiceUpdateError } = await supabase
        .from("client_profiles")
        .update({ printed_invoice_requested: !!printedInvoiceRequested, updated_at: new Date().toISOString() })
        .eq("id", clientProfile.id)
        .select()
        .single();

      if (!printedInvoiceUpdateError && updatedProfile) {
        clientProfile = updatedProfile;
      } else {
        console.error("Failed to update client printed invoice preference:", printedInvoiceUpdateError);
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

    // v8.3 E7: conectar el riesgo de propiedad (property_risk_assessments) al
    // momento de cotizar/reservar. Antes de esto, evaluatePropertyRisk se
    // calculaba y se guardaba pero jamás se consultaba aquí.
    const propertyRisk = await findPropertyRiskForAddress(supabase, clientProfile.id, address);
    const riskConsequence = evaluateBookingRiskConsequence(
      propertyRisk ? { tier: propertyRisk.tier, hardBlocked: propertyRisk.hardBlocked } : null
    );

    if (!riskConsequence.allowed) {
      return NextResponse.json(
        { error: riskConsequence.blockReason, code: "PROPERTY_RISK_BLOCKED" },
        { status: 403 }
      );
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

    // v8.3 E4 (D.7): zonas add-on (ej. Garaje) editables por el admin.
    // Recalculado siempre en servidor, nunca confía en un monto del cliente.
    const availableAddonZones = await fetchAddonZoneOptions(supabase, serviceSubtype!);
    const addonZonesCharge = calculateAddonZonesCharge(
      availableAddonZones,
      rawInput.addonZones || [],
      targetHourlyRate
    );
    const validatedAddonZones = (rawInput.addonZones || []).filter((z) =>
      availableAddonZones.some((a) => a.zone === z)
    );

    // Motor de reglas headless (src/lib/rules.ts): se leen las reglas activas
    // y se arma el contexto ANTES de llamar a calculatePrice, que ahora
    // invoca applyPricingRules() internamente (fix auditoría externa,
    // hallazgo #1 -- antes calculatePrice ignoraba el motor por completo y
    // devolvía ruleAdjustment/appliedRules hardcodeados).
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

    // Fix (auditoría externa, hallazgo confirmado): zoneDemand ya no es un
    // placeholder fijo -- se calcula desde la ocupación real de
    // capacity_slots (ver src/lib/zone-demand.ts). Todavía no hay fecha de
    // servicio elegida en este punto del flujo (se elige en
    // /api/quote/recalculate), así que se usa el promedio de ocupación de
    // los próximos 14 días publicados para esta zona como proxy.
    const zoneDemand = await getZoneDemand(supabase, zone!, null);

    const ruleContextExtra: Partial<RuleContext> = {
      serviceSubtype: serviceSubtype!,
      clientScore: clientProfile.score,
      servicesCount: clientProfile.services_count || 0,
      disputesLostCount: clientProfile.disputes_lost_count || 0,
      accountType,
      clientType: deriveClientType(clientProfile.services_count || 0, clientProfile.score),
      zoneDemand,
      organicLoad: deriveOrganicLoad(petsCount, petsType, residents),
      advanceNoticeDays: 0, // se actualiza en /api/quote/recalculate cuando el cliente elige fecha
    };

    // Calcular precio en servidor. Fix (auditoría 2026-07-31, hallazgo #5):
    // se usa un lunes neutro (dayOfWeek ?? 1) + isPreferredDay=true por
    // defecto cuando el cliente todavía no eligió fecha de servicio (paso
    // "summary" del cotizador), para que ninguna regla de pricing_rules
    // condicionada por dayOfWeek (ej. recargo de fin de semana) dispare por
    // accidente según el día real de HOY en el servidor. El día de servicio
    // real recién se conoce y se usa para el cálculo AUTORITATIVO en
    // /api/quote/recalculate.
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

    if (baseBreakdown.blocked) {
      return NextResponse.json(
        {
          error: baseBreakdown.blockReason || "Quote blocked by pricing rule",
          code: "RULE_BLOCKED",
        },
        { status: 400 }
      );
    }

    // v8.3 E6.6: recargo de factura impresa (+$2 B2C; $0 B2B/Gov, ver
    // src/lib/pricing.ts computePrintedInvoiceCharge). Se registra como una
    // AppliedRule sintética (no una regla real de pricing_rules) para que
    // quede visible en el desglose y auditable en quotes.applied_rules sin
    // agregar una columna dedicada.
    const finalPrintedInvoiceRequested =
      printedInvoiceRequested !== undefined ? !!printedInvoiceRequested : !!clientProfile.printed_invoice_requested;
    const printedInvoiceCharge = computePrintedInvoiceCharge(finalPrintedInvoiceRequested, accountType as "b2c" | "b2b" | "government");
    const appliedRules = [...baseBreakdown.appliedRules];
    if (printedInvoiceCharge > 0) {
      appliedRules.push({
        ruleId: "printed_invoice_surcharge",
        name: "Printed invoice by mail (+$2)",
        actionType: "price_add",
        actionValue: printedInvoiceCharge,
        adjustment: printedInvoiceCharge,
      });
    }

    // baseBreakdown.subtotal/gst/pst/total ya incluyen el ajuste real del
    // motor de reglas (computeTaxBreakdown, aritmética en centavos -- fix
    // auditoría externa, hallazgo #2). Solo falta sumar el recargo de
    // factura impresa, que no es una regla de pricing_rules.
    const { subtotal: subtotalAfterRules, gst, pst, total: totalAfterRules } = computeTaxBreakdown(
      baseBreakdown.subtotal + printedInvoiceCharge
    );
    const ruleAdjustment = baseBreakdown.ruleAdjustment + printedInvoiceCharge;
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

    // baseBreakdown.adminReviewRequired ya incluye el margen pre-reglas y
    // baseBreakdown.flagged (motor de reglas); marginBelowFloor cubre el
    // margen final post-reglas + factura impresa.
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
    if (riskConsequence.requiresAdminReview) {
      adminReviewRequired = true;
      adminReviewReasons.push(riskConsequence.adminReviewReason!);
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
        addon_zones: validatedAddonZones,
        addon_zones_charge: baseBreakdown.addonZonesCharge,
        rule_adjustment: ruleAdjustment,
        applied_rules: appliedRules,
        // Fix CRÍTICO (auditoría externa de integridad financiera,
        // 2026-08-02): quotes.subtotal y quotes.hold_amount son columnas
        // INTEGER en DÓLARES (sin decimales), mientras que total/gst/pst son
        // NUMERIC(10,2) y sí preservan centavos. subtotalAfterRules viene de
        // computeTaxBreakdown() con aritmética en centavos y puede traer
        // fracción de dólar (ej. 123.45) -- escribirlo tal cual en una
        // columna INTEGER dependía de que Postgres/el driver truncaran o
        // redondearan implícitamente, sin que quedara documentado en el
        // código qué pasaba con esos centavos. Se redondea aquí de forma
        // EXPLÍCITA (Math.round) para que la pérdida de precisión sea
        // intencional y visible, no implícita. holdAmount ya sale entero de
        // calculateHold(), pero se redondea igual por defensa. La migración
        // completa de estas columnas a centavos (o a NUMERIC) es un cambio
        // de esquema mayor, fuera de alcance de este fix -- ver migración
        // 311 (COMMENT ON COLUMN) que documenta esta unidad a nivel de
        // esquema para prevenir que se repita el mismo error en otro lugar.
        subtotal: Math.round(subtotalAfterRules),
        gst,
        pst,
        total: totalAfterRules,
        hold_amount: Math.round(holdAmount),
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
        acquisition_channel: acquisitionChannel || null,
        client_property_id: propertyRisk?.propertyId ?? null,
        requires_field_auditor: riskConsequence.requiresFieldAuditor,
        property_risk_tier: propertyRisk?.tier ?? "standard",
        tc_version: CONSENT_VERSIONS.tc,
        pipa_version: CONSENT_VERSIONS.pipa,
        marketing_version: CONSENT_VERSIONS.marketing,
        photo_marketing_version: CONSENT_VERSIONS.photoMarketing,
        consent_ip: clientIp,
        consent_accepted_at: acceptedAt,
        client_score: clientProfile.score,
      })
      .select(QUOTE_CLIENT_COLUMNS)
      .single();

    if (error) {
      return safeErrorResponse(error, 500, "Failed to create quote");
    }

    // v8.3 E2.10: pago fraccionado 50/50, solo informativo en esta respuesta
    // (elegibilidad + desglose sugerido) — el cliente elige explícitamente
    // useInstallmentPlan al confirmar la reserva (/api/stripe/confirm).
    // quotes.total is in dollars; orders.total_paid_cents must be in cents
    const totalCents = dollarsToCents(Number(data.total));
    assertCentsReasonable(totalCents, `quote/${data.id}/total`);
    const installmentEligible = isEligibleForInstallmentPlan(totalCents);
    const installmentSplitPreview = installmentEligible ? computeInstallmentSplit(totalCents) : null;

    // v8.3 B.2.3: el cliente ve SOLO el booleano de revisión — el motivo
    // (margen interno, score, etc.) es información interna del negocio.
    // Fix 2026-07-24 (auditoría externa): profileWarning es un campo
    // opcional adicional (no rompe el contrato existente) para que el
    // frontend, si quiere, muestre un aviso discreto tipo "no pudimos
    // guardar tus preferencias, pero tu cotización es válida" cuando
    // getOrCreateClientProfile falló y las actualizaciones de consentimiento/
    // idioma/factura/B2B se saltaron en silencio (ver profileCreationFailed
    // en getOrCreateClientProfile más abajo).
    return NextResponse.json(
      {
        quote: data,
        quoteId: data.id,
        serverCalculated: true,
        appliedRules,
        printedInvoiceCharge,
        adminReviewRequired,
        accountType,
        b2bReviewRequired: accountType === "b2b" || accountType === "government",
        installmentEligible,
        installmentSplitPreview,
        ...(clientProfile.profileCreationFailed ? { profileWarning: true } : {}),
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 500, "Failed to create quote");
  }
}

export async function GET(_request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _request;
  try {
    const supabase = createRouteSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("quotes")
      .select(QUOTE_CLIENT_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return safeErrorResponse(error, 500, "Failed to load quotes");
    }

    return NextResponse.json({ quotes: data }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 500, "Failed to load quotes");
  }
}

/**
 * v8.3 E7: busca la propiedad del cliente que corresponde a la dirección
 * cotizada (match por client_profile_id + dirección normalizada) y devuelve
 * su evaluación de riesgo MÁS RECIENTE (property_risk_assessments), si
 * existe. Direcciones nuevas o sin evaluación registrada devuelven null —
 * sin evidencia de riesgo, no hay consecuencia (regla conservadora: nunca
 * bloquear por defecto).
 */
async function findPropertyRiskForAddress(
  supabase: ReturnType<typeof createRouteSupabaseClient>,
  clientProfileId: string,
  address: string
): Promise<{ propertyId: string; tier: RiskTier; hardBlocked: boolean } | null> {
  if (!clientProfileId) return null;

  const normalizedTarget = normalizeAddressForMatch(address);

  const { data: properties, error: propertiesError } = await supabase
    .from("client_properties")
    .select("id, address")
    .eq("client_profile_id", clientProfileId)
    .is("deleted_at", null);

  if (propertiesError || !properties || properties.length === 0) {
    return null;
  }

  const match = properties.find(
    (p) => normalizeAddressForMatch(String(p.address)) === normalizedTarget
  );
  if (!match) return null;

  const { data: assessment, error: assessmentError } = await supabase
    .from("property_risk_assessments")
    .select("tier, hard_blocked")
    .eq("client_property_id", match.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (assessmentError || !assessment) return null;

  return {
    propertyId: match.id as string,
    tier: assessment.tier as RiskTier,
    hardBlocked: assessment.hard_blocked as boolean,
  };
}

async function getOrCreateClientProfile(supabase: ReturnType<typeof createRouteSupabaseClient>, userId: string) {
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
    // Fix 2026-07-24 (auditoría externa): cuando falla crear/recuperar el
    // client_profile, el fallback sintético de abajo (id:"") es correcto --
    // un fallo de infraestructura no debe bloquear la cotización, y las
    // actualizaciones posteriores (consentimientos, idioma preferido,
    // factura impresa, upgrade B2B) ya están protegidas con
    // `if (clientProfile.id && ...)` así que no lanzan error. El problema es
    // que antes se SALTABAN en silencio -- solo un console.error que nadie
    // revisa en producción. Se usa ahora captureError (src/lib/observability.ts,
    // mismo patrón logged_locally/forwarded_to_sentry que el resto del
    // repo) para dejar esto rastreable, y se marca profileCreationFailed en
    // el perfil sintético para que el caller pueda exponer un aviso opcional
    // al cliente sin cambiar el contrato existente de la respuesta.
    captureError(error, {
      module: "api/quote",
      operation: "getOrCreateClientProfile",
      userId,
    });
    // Fallback: devolver un perfil sintético para no romper la cotización
    return {
      id: "",
      user_id: userId,
      score: 50,
      services_count: 0,
      disputes_count: 0,
      no_show_count: 0,
      account_type: "b2c",
      profileCreationFailed: true,
    };
  }

  return created;
}

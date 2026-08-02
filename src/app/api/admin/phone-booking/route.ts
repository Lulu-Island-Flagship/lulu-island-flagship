import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import {
  calculatePrice,
  calculateHold,
  getTargetHourlyRate,
  getCurrentHHETable,
  CONSENT_VERSIONS,
  ServiceType,
  MARGIN_FLOOR_PERCENT,
  computePrintedInvoiceCharge,
  computeTaxBreakdown,
  ACTIVE_ZONES,
  SERVICE_CATEGORIES,
  SERVICE_SUBTYPES,
  PET_TYPES,
  type ServiceCategory,
} from "@/lib/pricing";
import { type RuleContext, type PricingRule, type AppliedRule } from "@/lib/rules";
import { getZoneDemand } from "@/lib/zone-demand";
import { calculateAddonZonesCharge } from "@/lib/pricing";
import { fetchAddonZoneOptions } from "@/lib/addon-zones";
import { geocodeAddress } from "@/lib/geocode";
import { calculateClientScore } from "@/lib/scoring";
import { QUOTE_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import {
  evaluateBookingRiskConsequence,
  normalizeAddressForMatch,
  type RiskTier,
} from "@/lib/property-risk";

/**
 * v8.3 E6.6 — Reserva por teléfono.
 *
 * Del plan (Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md, E6, punto 6): "reserva
 * por teléfono (número local Richmond, 7AM-9PM, 7 días; coordinador usa el
 * MISMO cotizador web; SetupIntent por teléfono en sistema seguro, nunca
 * papel)".
 *
 * Este endpoint es la mitad "cotizador" de esa promesa: un coordinador
 * autenticado (rol admin `phone_booking`) toma los mismos datos crudos que
 * el cotizador web (src/app/[locale]/cotizador) mientras habla con el
 * cliente por teléfono, y llama EXACTAMENTE las mismas funciones puras de
 * src/lib/pricing.ts que /api/quote/route.ts -- nunca reimplementa el
 * cálculo. El resultado se inserta en `quotes` con source='phone' para que
 * quede trazable de dónde vino, pero es indistinguible en su matemática de
 * una cotización web (mismo criterio de aceptación E6: "Una reserva
 * telefónica produce exactamente la misma orden que una web").
 *
 * HONESTO SOBRE LO QUE FALTA (no se inventa nada no verificable):
 * 1. No hay número de teléfono real de Richmond ni horario 7AM-9PM
 *    atendido -- eso es un proceso humano/telefonía (Twilio + línea
 *    contratada), no código. Este endpoint es la herramienta que el
 *    coordinador humano usaría UNA VEZ que existan la línea y el horario.
 * 2. "SetupIntent por teléfono... nunca papel": este endpoint NO captura
 *    número de tarjeta. Tomar datos de tarjeta dictados por teléfono y
 *    tipearlos en cualquier sistema (incluso este) violaría PCI-DSS. La
 *    cotización se crea aquí; el pago real (SetupIntent + creación de la
 *    orden) sigue pasando por /api/stripe/confirm, exactamente el mismo
 *    endpoint que usa el cotizador web -- el coordinador le envía al
 *    cliente un link seguro para que introduzca su propia tarjeta (o la
 *    introduce el cliente leyéndola mientras el coordinador la tipea en un
 *    formulario de Stripe Elements en su propia pantalla, nunca guardada
 *    como texto). Esa integración de "Stripe Elements en pantalla del
 *    coordinador" queda como TODO explícito -- no existe todavía.
 * 3. Voicemail con callback <4h: no hay proveedor de voz conectado (mismo
 *    estado que src/lib/telephony-router.ts). No se simula.
 */

async function findPropertyRiskForAddress(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  clientProfileId: string,
  address: string
): Promise<{ propertyId: string; tier: RiskTier; hardBlocked: boolean } | null> {
  if (!clientProfileId) return null;
  const normalizedTarget = normalizeAddressForMatch(address);

  const { data: properties } = await supabase
    .from("client_properties")
    .select("id, address")
    .eq("client_profile_id", clientProfileId)
    .is("deleted_at", null);

  if (!properties || properties.length === 0) return null;

  const match = properties.find(
    (p: { address: string }) => normalizeAddressForMatch(String(p.address)) === normalizedTarget
  );
  if (!match) return null;

  const { data: assessment } = await supabase
    .from("property_risk_assessments")
    .select("tier, hard_blocked")
    .eq("client_property_id", match.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!assessment) return null;
  return { propertyId: match.id as string, tier: assessment.tier as RiskTier, hardBlocked: assessment.hard_blocked as boolean };
}

// Duplicado deliberado y mínimo de src/app/api/quote/route.ts (no exportadas
// allá). Si cambia la regla de negocio en un lugar, debe cambiar en el otro
// -- ver advertencia en el comentario de cabecera de este archivo.
function deriveClientType(servicesCount: number, clientScore: number): RuleContext["clientType"] {
  if (servicesCount === 0) return "new";
  if (servicesCount >= 10 && clientScore > 80) return "elite";
  return "returning";
}

function deriveOrganicLoad(petsCount: number, petsType: string, residents: number): RuleContext["organicLoad"] {
  if (petsCount >= 3 || residents >= 5) return "high";
  const hasLongHair =
    petsType.toLowerCase().includes("long") ||
    petsType.toLowerCase().includes("largo") ||
    petsType.toLowerCase().includes("multiple");
  if (hasLongHair || residents >= 3) return "medium";
  return "low";
}

interface PhoneBookingBody {
  clientEmail?: string;
  clientFullName?: string;
  clientPhone?: string;
  serviceCategory?: ServiceCategory;
  serviceSubtype?: string;
  serviceType?: ServiceType;
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  petsCount?: number;
  petsType?: string;
  residents?: number;
  daysSinceCleaning?: number;
  address?: string;
  zone?: string;
  postalCode?: string;
  dayOfWeek?: number;
  isPreferredDay?: boolean;
  addonZones?: string[];
  purchaseOrder?: string;
  noSmartphoneFlow?: boolean;
  printedInvoiceRequested?: boolean;
  /**
   * El coordinador confirma explícitamente que leyó T&C/PIPA al cliente y
   * que aceptó verbalmente -- reemplaza el clic del cotizador web. Se
   * registra igual que un consentimiento real (consent_ip = 'phone:<coordinador>').
   */
  consentConfirmedVerballyByCoordinator?: boolean;
}

function validatePhoneBookingInput(body: PhoneBookingBody): { valid: true } | { valid: false; error: string } {
  if (!body.clientEmail || !body.clientEmail.includes("@")) {
    return { valid: false, error: "A valid clientEmail is required to identify or create the client account." };
  }
  if (!body.serviceCategory || !SERVICE_CATEGORIES.some((c) => c.key === body.serviceCategory)) {
    return { valid: false, error: "Invalid service category" };
  }
  const validSubtypes = SERVICE_SUBTYPES[body.serviceCategory as ServiceCategory].map((s) => s.key);
  if (!body.serviceSubtype || !validSubtypes.some((s) => s === body.serviceSubtype)) {
    return { valid: false, error: `Invalid service subtype for category ${body.serviceCategory}` };
  }
  const mappedType = SERVICE_SUBTYPES[body.serviceCategory as ServiceCategory].find(
    (s) => s.key === body.serviceSubtype
  )?.mapsTo;
  if (!body.serviceType || body.serviceType !== mappedType) {
    return { valid: false, error: "Service type does not match subtype mapping" };
  }
  if (body.bedrooms === undefined || !Number.isInteger(body.bedrooms) || body.bedrooms < 0) {
    return { valid: false, error: "Invalid bedrooms" };
  }
  if (body.bathrooms === undefined || !Number.isInteger(body.bathrooms) || body.bathrooms < 0) {
    return { valid: false, error: "Invalid bathrooms" };
  }
  if (
    body.squareFeet === undefined ||
    !Number.isInteger(body.squareFeet) ||
    body.squareFeet < 300 ||
    body.squareFeet > 10000
  ) {
    return { valid: false, error: "Square footage must be an integer between 300 and 10000" };
  }
  if (
    body.petsCount === undefined ||
    !Number.isInteger(body.petsCount) ||
    body.petsCount < 0 ||
    !body.petsType ||
    !PET_TYPES.includes(body.petsType as (typeof PET_TYPES)[number])
  ) {
    return { valid: false, error: "Invalid pet information" };
  }
  if (body.residents === undefined || !Number.isInteger(body.residents) || body.residents < 1) {
    return { valid: false, error: "Residents must be a positive integer" };
  }
  if (body.daysSinceCleaning === undefined || !Number.isInteger(body.daysSinceCleaning) || body.daysSinceCleaning < 0) {
    return { valid: false, error: "Invalid recency value" };
  }
  if (!body.address || body.address.trim().length < 5) {
    return { valid: false, error: "Address is required" };
  }
  if (!body.zone || !ACTIVE_ZONES.some((z) => z.name === body.zone)) {
    return { valid: false, error: "Invalid or unsupported service zone" };
  }
  const normalizedPostal = body.postalCode?.replace(/\s/g, "").toUpperCase() || "";
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(normalizedPostal)) {
    return { valid: false, error: "Invalid Canadian postal code" };
  }
  if (body.consentConfirmedVerballyByCoordinator !== true) {
    return {
      valid: false,
      error: "consentConfirmedVerballyByCoordinator must be true -- the coordinator must read T&C/PIPA to the client and confirm verbal acceptance before booking.",
    };
  }
  return { valid: true };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("phone_booking", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const serviceRole = getServiceRoleClient();
  if (!serviceRole) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured -- cannot look up/create client accounts for phone bookings." },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as PhoneBookingBody;
    const validation = validatePhoneBookingInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      clientEmail, clientFullName, clientPhone,
      serviceCategory, serviceSubtype, serviceType,
      bedrooms, bathrooms, squareFeet, petsCount, petsType, residents,
      daysSinceCleaning, address, zone, postalCode, dayOfWeek, isPreferredDay,
      addonZones, purchaseOrder, noSmartphoneFlow, printedInvoiceRequested,
    } = body;

    const normalizedEmail = clientEmail!.trim().toLowerCase();

    // 1. Encontrar o crear la cuenta del cliente. profiles.email es espejo de
    // auth.users.email (migración 135) -- se puede buscar sin usar la API de
    // administración paginada de auth.
    let userId: string;
    const { data: existingProfile } = await serviceRole
      .from("profiles")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      userId = existingProfile.id as string;
    } else {
      const { data: created, error: createErr } = await serviceRole.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        phone: clientPhone || undefined,
        user_metadata: { full_name: clientFullName || undefined, created_via: "phone_booking" },
      });
      if (createErr || !created?.user) {
        return NextResponse.json(
          { error: `Could not create client account: ${createErr?.message || "unknown error"}` },
          { status: 500 }
        );
      }
      userId = created.user.id;
      // El trigger sync_profile_email (migración 135) ya insertó la fila de
      // profiles con id+email -- solo falta completar nombre/teléfono.
      await serviceRole
        .from("profiles")
        .update({ full_name: clientFullName || null, phone: clientPhone || null })
        .eq("id", userId);
    }

    // 2. Perfil de cliente (score, tipo de cuenta) -- mismo criterio que
    // getOrCreateClientProfile en /api/quote/route.ts.
    let { data: clientProfile } = await serviceRole
      .from("client_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!clientProfile) {
      const { data: createdProfile, error: profileErr } = await serviceRole
        .from("client_profiles")
        .insert({ user_id: userId, score: 50 })
        .select()
        .single();
      if (profileErr || !createdProfile) {
        return NextResponse.json({ error: `Could not create client profile: ${profileErr?.message}` }, { status: 500 });
      }
      clientProfile = createdProfile;
    }

    const profileUpdates: Record<string, unknown> = {};
    if (noSmartphoneFlow !== undefined) profileUpdates.no_smartphone_flow = !!noSmartphoneFlow;
    if (printedInvoiceRequested !== undefined) profileUpdates.printed_invoice_requested = !!printedInvoiceRequested;

    let accountType = clientProfile.account_type || "b2c";
    const isCommercialCategory = serviceCategory === "commercial";
    if (isCommercialCategory && accountType === "b2c") {
      profileUpdates.account_type = "b2b";
      accountType = "b2b";
    }

    if (Object.keys(profileUpdates).length > 0) {
      profileUpdates.updated_at = new Date().toISOString();
      const { data: updated, error: updateErr } = await serviceRole
        .from("client_profiles")
        .update(profileUpdates)
        .eq("id", clientProfile.id)
        .select()
        .single();
      if (!updateErr && updated) {
        clientProfile = updated;
        accountType = clientProfile.account_type;
      }
    }

    if (accountType === "b2b" || accountType === "government") {
      if (!purchaseOrder || purchaseOrder.trim().length === 0) {
        return NextResponse.json(
          { error: "B2B / Government phone bookings require a Purchase Order (PO) number." },
          { status: 400 }
        );
      }
    }

    if (clientProfile.score < 0) {
      return NextResponse.json(
        { error: "This account requires manual review before booking (score below 0).", code: "BLOCKED_LOW_SCORE" },
        { status: 403 }
      );
    }

    // 3. Riesgo de propiedad -- mismo gate que el cotizador web.
    const propertyRisk = await findPropertyRiskForAddress(serviceRole, clientProfile.id, address!);
    const riskConsequence = evaluateBookingRiskConsequence(
      propertyRisk ? { tier: propertyRisk.tier, hardBlocked: propertyRisk.hardBlocked } : null
    );
    if (!riskConsequence.allowed) {
      return NextResponse.json({ error: riskConsequence.blockReason, code: "PROPERTY_RISK_BLOCKED" }, { status: 403 });
    }

    // 4. Score recalculado (igual que /api/quote).
    const computedScore = calculateClientScore({
      servicesCount: clientProfile.services_count || 0,
      disputesLostCount: clientProfile.disputes_lost_count || 0,
      noShowCount: clientProfile.no_show_count || 0,
    });
    if (computedScore !== clientProfile.score) {
      await serviceRole.from("client_profiles").update({ score: computedScore }).eq("id", clientProfile.id);
      clientProfile.score = computedScore;
    }

    // 5. MISMAS funciones de precio que /api/quote/route.ts (src/lib/pricing.ts) --
    // esto es lo que garantiza el criterio de aceptación E6 "misma orden que una web".
    const targetHourlyRate = await getTargetHourlyRate(serviceRole);
    const hheTable = await getCurrentHHETable(serviceRole);
    const availableAddonZones = await fetchAddonZoneOptions(serviceRole, serviceSubtype!);
    const addonZonesCharge = calculateAddonZonesCharge(availableAddonZones, addonZones || [], targetHourlyRate);
    const validatedAddonZones = (addonZones || []).filter((z) => availableAddonZones.some((a) => a.zone === z));

    // Reglas de pricing activas + contexto se arman ANTES de llamar a
    // calculatePrice, que ahora invoca applyPricingRules() internamente (fix
    // auditoría externa, hallazgo #1).
    const { data: rulesData } = await serviceRole
      .from("pricing_rules")
      .select("id, name, description, condition_json, action_type, action_value, priority, max_applicable, is_active")
      .is("deleted_at", null)
      .eq("is_active", true);

    const rules: PricingRule[] = (rulesData || []).map((r: Record<string, unknown>) => ({
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
    // El coordinador todavía no eligió fecha en este paso -- promedio
    // rolling de 14 días para la zona, igual que quote/route.ts.
    const zoneDemand = await getZoneDemand(serviceRole, zone!, null);

    const ruleContextExtra: Partial<RuleContext> = {
      serviceSubtype: serviceSubtype!,
      clientScore: clientProfile.score,
      servicesCount: clientProfile.services_count || 0,
      disputesLostCount: clientProfile.disputes_lost_count || 0,
      accountType,
      clientType: deriveClientType(clientProfile.services_count || 0, clientProfile.score),
      zoneDemand,
      organicLoad: deriveOrganicLoad(petsCount!, petsType!, residents!),
      advanceNoticeDays: 0,
    };

    const baseBreakdown = calculatePrice(
      serviceType as ServiceType,
      squareFeet!,
      petsCount!,
      petsType!,
      residents!,
      daysSinceCleaning!,
      zone!,
      dayOfWeek,
      isPreferredDay,
      targetHourlyRate,
      hheTable,
      addonZonesCharge,
      rules,
      ruleContextExtra
    );

    if (baseBreakdown.blocked) {
      return NextResponse.json({ error: baseBreakdown.blockReason || "Quote blocked by pricing rule", code: "RULE_BLOCKED" }, { status: 400 });
    }

    // 6. Factura impresa opcional (+$2 B2C; B2B/Gov siempre incluida, ver
    // migración 201). Se registra como una AppliedRule sintética (no una
    // regla real de pricing_rules) para que quede visible en el desglose
    // (appliedRules) y auditable en quotes.applied_rules -- sin necesidad de
    // una columna nueva dedicada en `quotes`.
    const finalPrintedInvoiceRequested =
      printedInvoiceRequested !== undefined ? !!printedInvoiceRequested : !!clientProfile.printed_invoice_requested;
    const printedInvoiceCharge = computePrintedInvoiceCharge(finalPrintedInvoiceRequested, accountType);
    const appliedRules: AppliedRule[] = [...baseBreakdown.appliedRules];
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
    // motor de reglas (aritmética en centavos -- fix auditoría externa,
    // hallazgos #1 y #2). Solo falta sumar el recargo de factura impresa.
    const { subtotal: subtotalAfterRules, gst, pst, total: totalAfterRules } = computeTaxBreakdown(
      baseBreakdown.subtotal + printedInvoiceCharge
    );
    const ruleAdjustment = baseBreakdown.ruleAdjustment + printedInvoiceCharge;
    const holdAmount = calculateHold(serviceType as ServiceType, squareFeet!, totalAfterRules, targetHourlyRate);

    const freeze = new Date(Date.now() + 10 * 60 * 1000);
    const acceptedAt = new Date().toISOString();
    const coordinates = await geocodeAddress(address!);

    const estimatedLaborCost = baseBreakdown.estimatedLaborCost;
    const marginContribution = subtotalAfterRules > 0 ? (subtotalAfterRules - estimatedLaborCost) / subtotalAfterRules : 0;
    const marginBelowFloor = marginContribution < MARGIN_FLOOR_PERCENT;

    let adminReviewRequired = baseBreakdown.adminReviewRequired || marginBelowFloor;
    const adminReviewReasons: string[] = [];
    if (baseBreakdown.adminReviewReason) adminReviewReasons.push(baseBreakdown.adminReviewReason);
    if (marginBelowFloor) {
      adminReviewReasons.push(
        `Contribution margin ${(marginContribution * 100).toFixed(1)}% below the ${(MARGIN_FLOOR_PERCENT * 100).toFixed(0)}% floor after rules`
      );
    }
    if (riskConsequence.requiresAdminReview) {
      adminReviewRequired = true;
      adminReviewReasons.push(riskConsequence.adminReviewReason!);
    }
    if (accountType === "b2b" || accountType === "government") {
      adminReviewRequired = true;
      adminReviewReasons.push("B2B / Government account requires manual onboarding, PO process, and Net-30 setup before booking");
    }
    adminReviewReasons.push(`Phone booking taken by coordinator ${auth.user.id} (${auth.roles.join(",")})`);

    const { data, error } = await serviceRole
      .from("quotes")
      .insert({
        user_id: userId,
        source: "phone",
        service_category: serviceCategory,
        service_subtype: serviceSubtype,
        service_type: serviceType,
        bedrooms, bathrooms, square_feet: squareFeet,
        pets_count: petsCount, pets_type: petsType, residents,
        days_since_cleaning: daysSinceCleaning,
        address, zone, postal_code: postalCode,
        day_of_week: dayOfWeek, is_preferred_day: isPreferredDay,
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
        subtotal: subtotalAfterRules,
        gst, pst, total: totalAfterRules,
        hold_amount: holdAmount,
        estimated_labor_cost: estimatedLaborCost,
        estimated_margin_contribution: marginContribution,
        price_frozen_until: freeze.toISOString(),
        status: "pending",
        admin_review_required: adminReviewRequired,
        admin_review_reason: adminReviewReasons.join("; ") || null,
        consent_tc: true,
        consent_pipa: true,
        consent_marketing: false,
        pipa_alt_requires_audit: false,
        purchase_order: purchaseOrder || null,
        acquisition_channel: "phone",
        client_property_id: propertyRisk?.propertyId ?? null,
        requires_field_auditor: riskConsequence.requiresFieldAuditor,
        property_risk_tier: propertyRisk?.tier ?? "standard",
        tc_version: CONSENT_VERSIONS.tc,
        pipa_version: CONSENT_VERSIONS.pipa,
        marketing_version: CONSENT_VERSIONS.marketing,
        photo_marketing_version: CONSENT_VERSIONS.photoMarketing,
        consent_ip: `phone:coordinator:${auth.user.id}`,
        consent_accepted_at: acceptedAt,
        client_score: clientProfile.score,
      })
      .select(QUOTE_CLIENT_COLUMNS)
      .single();

    if (error) {
      console.error("Phone booking quote insert error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      {
        quote: data,
        quoteId: data.id,
        clientUserId: userId,
        serverCalculated: true,
        appliedRules,
        printedInvoiceCharge,
        adminReviewRequired,
        accountType,
        b2bReviewRequired: accountType === "b2b" || accountType === "government",
        breakdownForCoordinatorToRead: {
          basePrice: baseBreakdown.basePrice,
          organicAdjustment: baseBreakdown.organicAdjustment,
          recencyAdjustment: baseBreakdown.recencyAdjustment,
          zoneSurcharge: baseBreakdown.zoneSurcharge,
          logisticsSurcharge: baseBreakdown.logisticsSurcharge,
          addonZonesCharge: baseBreakdown.addonZonesCharge,
          printedInvoiceCharge,
          ruleAdjustment,
          subtotal: subtotalAfterRules,
          gst, pst, total: totalAfterRules,
          holdAmount,
        },
        nextStep:
          "Payment is never taken by phone/paper (PCI). Send the client the secure checkout link for this quoteId " +
          "(reuses /api/stripe/confirm, the same endpoint the web quoter uses) so they enter their own card, " +
          "or read them the link to enter it themselves while on the call.",
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

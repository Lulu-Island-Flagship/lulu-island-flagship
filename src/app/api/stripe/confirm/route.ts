import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import {
  getVancouverOffset,
  getVancouverTodayMidnight,
  getVancouverTodayString,
} from "@/lib/date-utils";
import { verifyPayPalTransaction } from "@/lib/paypal";
import { dispatchCommunication } from "@/lib/send-communication";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
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
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      quoteId,
      serviceDate,
      serviceTime,
      paymentMethodId,
      stripeCustomerId,
      stripeSetupIntentId,
      paymentOption,
      paypalTransactionId,
      paypalPayerEmail,
    } = body;

    if (!quoteId || !serviceDate || !serviceTime || !paymentMethodId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const requestedOption = paymentOption === "paypal_first_time" ? "paypal_first_time" : "card";

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validar formato de hora HH:MM y rango de servicio 08:00-18:00
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(serviceTime)) {
      return NextResponse.json(
        { error: "Invalid time format. Use HH:MM" },
        { status: 400 }
      );
    }
    const [hourStr] = serviceTime.split(":");
    const hour = parseInt(hourStr, 10);
    if (hour < 8 || hour >= 18) {
      return NextResponse.json(
        { error: "Service time must be between 08:00 and 18:00" },
        { status: 400 }
      );
    }

    // Build ISO datetime from date + time (Vancouver timezone, PST/PDT aware)
    const offset = getVancouverOffset(serviceDate);
    const serviceDatetime = new Date(`${serviceDate}T${serviceTime}:00${offset}`);
    if (isNaN(serviceDatetime.getTime())) {
      return NextResponse.json(
        { error: "Invalid date or time" },
        { status: 400 }
      );
    }

    // Validate date range using Vancouver timezone
    const vancouverToday = getVancouverTodayMidnight();
    const serviceDateObj = new Date(`${serviceDate}T00:00:00${offset}`);

    const tomorrow = new Date(vancouverToday);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const oneYearLater = new Date(vancouverToday);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    if (serviceDateObj < tomorrow) {
      return NextResponse.json(
        { error: "Service must be scheduled at least 1 day in advance" },
        { status: 400 }
      );
    }

    if (serviceDateObj > oneYearLater) {
      return NextResponse.json(
        { error: "Service cannot be scheduled more than 1 year in advance" },
        { status: 400 }
      );
    }

    // Corte de las 5:00 PM del día anterior para reservas de mañana
    const todayStr = getVancouverTodayString();
    const vancouverNowParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const currentHour = Number(vancouverNowParts.find((p) => p.type === "hour")?.value ?? 0);
    if (serviceDate > todayStr && currentHour >= 17) {
      return NextResponse.json(
        { error: "Bookings for tomorrow close at 5:00 PM. Please select a later date." },
        { status: 400 }
      );
    }

    // Verify quote exists and belongs to user
    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, service_subtype, service_type, square_feet, zone, price_frozen_until, total, hold_amount, address_lat, address_lng, admin_review_required, user_id, pipa_alt_requires_audit, purchase_order, client_property_id, requires_field_auditor, property_risk_tier, addon_zones")
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .single();

    if (quoteError || !quoteRow) {
      return NextResponse.json(
        { error: "Quote not found or unauthorized" },
        { status: 404 }
      );
    }

    // Revalidación de seguridad: cotizaciones con revisión admin o cuentas B2B/Gob
    // nunca deben convertirse en órdenes por este flujo B2C.
    if (quoteRow.admin_review_required) {
      return NextResponse.json(
        { error: "Quote requires administrative review. Online booking is not available." },
        { status: 403 }
      );
    }

    const { data: clientProfile } = await supabase
      .from("client_profiles")
      .select("account_type, services_count, preferred_languages")
      .eq("user_id", quoteRow.user_id)
      .single();

    if (clientProfile?.account_type === "b2b" || clientProfile?.account_type === "government") {
      return NextResponse.json(
        { error: "Commercial / Government accounts require manual onboarding. Online booking is not available." },
        { status: 403 }
      );
    }

    // Validar opción de pago: PayPal solo para primer servicio
    const isFirstTimeService =
      quoteRow.service_subtype === "first_time" || clientProfile?.services_count === 0;

    if (requestedOption === "paypal_first_time" && !isFirstTimeService) {
      return NextResponse.json(
        { error: "PayPal is only available for first-time services. Please use card." },
        { status: 400 }
      );
    }

    const selectedPaymentOption: "card" | "paypal_first_time" = requestedOption;

    // SetupIntent de Stripe es obligatorio en AMBAS opciones (spec v8.2).
    if (!stripeSetupIntentId) {
      return NextResponse.json(
        { error: "Card registration is required for all reservations, including PayPal first service." },
        { status: 400 }
      );
    }

    // Para PayPal se requiere transactionId
    if (selectedPaymentOption === "paypal_first_time" && !paypalTransactionId) {
      return NextResponse.json(
        { error: "Missing PayPal transaction ID" },
        { status: 400 }
      );
    }
    if (selectedPaymentOption === "paypal_first_time") {
      // Validación básica: formato alfanumérico de 12-20 caracteres
      const paypalId = String(paypalTransactionId).trim();
      if (!/^[A-Za-z0-9]{12,20}$/.test(paypalId)) {
        return NextResponse.json(
          { error: "Invalid PayPal transaction ID format" },
          { status: 400 }
        );
      }

      // Evitar reutilización del mismo transactionId en otra orden
      const { data: existingPayPalOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("paypal_transaction_id", paypalId)
        .neq("status", "cancelled")
        .maybeSingle();

      if (existingPayPalOrder) {
        return NextResponse.json(
          { error: "This PayPal transaction ID has already been used" },
          { status: 409 }
        );
      }
    }

    // Check price freeze
    const frozenUntil = new Date(quoteRow.price_frozen_until);
    if (frozenUntil < new Date()) {
      return NextResponse.json(
        { error: "Quote has expired. Please generate a new quote." },
        { status: 410 }
      );
    }

    // Check for existing order (prevent double-submit). La constraint UNIQUE(quote_id)
    // es la última línea de defensa, pero este check devuelve una respuesta amigable.
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id, status")
      .eq("quote_id", quoteId)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json(
        { orderId: existingOrder.id, status: existingOrder.status, message: "Order already exists for this quote" },
        { status: 409 }
      );
    }

    const stripe = assertStripe();

    // Verificar SetupIntent con Stripe (seguridad: no confiar en paymentMethodId del cliente).
    const setupIntent = await stripe.setupIntents.retrieve(stripeSetupIntentId);
    if (setupIntent.status !== "succeeded") {
      return NextResponse.json(
        { error: "Payment method not verified. Please complete card setup." },
        { status: 402 }
      );
    }
    if (setupIntent.payment_method !== paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method mismatch. Please try again." },
        { status: 400 }
      );
    }

    // Use the server-calculated amounts from the quote; ignore client-provided values.
    // The quote was recalculated server-side, so this prevents price manipulation.
    const holdAmount = quoteRow.hold_amount ?? Math.round(Number(quoteRow.total) * 0.4);
    const paypalAdvanceAmount = Math.round(holdAmount * 0.5);

    // Verificar transacción de PayPal contra la API real (si está configurada).
    // El anticipo PayPal debe ser igual al 50% del Hold (spec v8.2).
    if (selectedPaymentOption === "paypal_first_time") {
      const paypalVerification = await verifyPayPalTransaction(
        String(paypalTransactionId).trim(),
        paypalAdvanceAmount
      );

      if (!paypalVerification.valid) {
        return NextResponse.json(
          { error: paypalVerification.error || "PayPal transaction could not be verified" },
          { status: 402 }
        );
      }
    }

    // En el flujo corregido NO autorizamos el hold en la confirmación.
    // El cron /api/cron/hold-authorize lo hará T-72h antes del servicio.
    // Esto evita que los holds expiren para servicios lejanos y cumple el spec.

    // Verificar capacidad real: el slot debe existir, estar publicado y tener cupo
    let slotRow;
    const { data: slotData, error: slotError } = await supabase
      .from("capacity_slots")
      .select("id, max_teams, committed_teams, slot_type")
      .eq("service_date", serviceDate)
      .eq("start_time", serviceTime)
      .or(`zone.eq."${quoteRow.zone}",zone.is.null`)
      .eq("is_published", true)
      .order("zone", { ascending: false }) // preferir slot específico de zona
      .limit(1)
      .single();
    slotRow = slotData;

    // Si no existe slot publicado, crear uno flexible por defecto
    if (slotError || !slotRow) {
      const [h, m] = serviceTime.split(":").map(Number);
      const endH = h + Math.floor((m + 30) / 60);
      const endM = (m + 30) % 60;
      const { data: createdSlot, error: createSlotError } = await supabase
        .from("capacity_slots")
        .insert({
          service_date: serviceDate,
          start_time: serviceTime,
          end_time: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
          zone: quoteRow.zone,
          slot_type: "flexible",
          max_teams: 1,
          committed_teams: 0,
          is_published: true,
          published_at: new Date().toISOString(),
        })
        .select("id, max_teams, committed_teams, slot_type")
        .single();

      if (createSlotError || !createdSlot) {
        return NextResponse.json(
          { error: "Unable to reserve selected time slot. Please try again." },
          { status: 500 }
        );
      }
      slotRow = createdSlot;
    }

    const slotAvailable = slotRow.slot_type !== "blocked" && slotRow.committed_teams < slotRow.max_teams;
    if (!slotAvailable) {
      return NextResponse.json(
        { error: "Selected time slot is no longer available. Please choose another time." },
        { status: 409 }
      );
    }

    // Create order
    // Para PayPal primer servicio, la tarjeta (SetupIntent) sigue siendo obligatoria
    // porque el cobro final del saldo restante siempre corre por Stripe.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        quote_id: quoteId,
        user_id: user.id,
        service_date: serviceDate,
        service_time: serviceTime,
        service_datetime: serviceDatetime.toISOString(),
        status: "confirmed",
        stripe_customer_id: stripeCustomerId || null,
        stripe_payment_method_id: paymentMethodId,
        stripe_setup_intent_id: stripeSetupIntentId,
        payment_option: selectedPaymentOption,
        paypal_transaction_id: selectedPaymentOption === "paypal_first_time" ? paypalTransactionId || null : null,
        paypal_payer_email: selectedPaymentOption === "paypal_first_time" ? paypalPayerEmail || null : null,
        paypal_advance_amount: selectedPaymentOption === "paypal_first_time" ? paypalAdvanceAmount : 0,
        hold_amount: holdAmount,
        hold_authorized_amount: 0,
        cancellation_window_hours: 72,
        address_lat: quoteRow.address_lat ?? null,
        address_lng: quoteRow.address_lng ?? null,
        pipa_alt_requires_audit: quoteRow.pipa_alt_requires_audit ?? false,
        purchase_order: quoteRow.purchase_order ?? null,
        client_property_id: quoteRow.client_property_id ?? null,
        requires_field_auditor: quoteRow.requires_field_auditor ?? false,
        property_risk_tier: quoteRow.property_risk_tier ?? "standard",
        // v8.3 E4 (D.7): zonas add-on seleccionadas en el cotizador, congeladas
        // con la orden — el checklist del líder solo las muestra si están aquí.
        addon_zones: quoteRow.addon_zones ?? [],
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order insert error:", orderError);
      return NextResponse.json(
        { error: orderError.message },
        { status: 500 }
      );
    }

    // Update quote status to reserved
    await supabase
      .from("quotes")
      .update({ status: "reserved" })
      .eq("id", quoteId);

    // Comprometer capacidad del slot reservado
    await supabase
      .from("capacity_slots")
      .update({
        committed_teams: slotRow.committed_teams + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", slotRow.id);

    // E6 Sesión H — conecta el catálogo de plantillas (migración 045/057,
    // hasta ahora sin ningún disparador real) al primer evento del ciclo de
    // vida de la orden. Un fallo aquí nunca debe invalidar una reserva ya
    // creada y pagada (SetupIntent) — por eso dispatchCommunication nunca
    // lanza y el resultado no se espera con bloqueo del response.
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] ||
        "en") as "en" | "es" | "zh";

      await dispatchCommunication(supabase, {
        eventKey: "order_confirmed",
        userId: user.id,
        orderId: order.id,
        language,
        vars: {
          client_name: profile?.full_name || "cliente",
          service_type: quoteRow.service_type,
          service_date: serviceDate,
          time_window: serviceTime,
          total: quoteRow.total,
          company_name: "Lulu Island",
        },
      });
    } catch (commErr) {
      console.error("Error disparando order_confirmed:", commErr);
    }

    return NextResponse.json(
      {
        orderId: order.id,
        status: "confirmed",
        holdAuthorized: false,
        holdScheduled: selectedPaymentOption === "card",
        paypalAdvanceAmount: selectedPaymentOption === "paypal_first_time" ? paypalAdvanceAmount : 0,
        paymentOption: selectedPaymentOption,
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Confirm reservation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

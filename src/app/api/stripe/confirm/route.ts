import { createClient } from "@supabase/supabase-js";

import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import {
  getVancouverOffset,
  getVancouverTodayMidnight,
} from "@/lib/date-utils";
import { checkBookingDateAllowed, dollarsToCents } from "@/lib/pricing";
import { verifyPayPalTransaction } from "@/lib/paypal";
import { dispatchCommunication } from "@/lib/send-communication";
import {
  isEligibleForInstallmentPlan,
  computeInstallmentSplit,
  computeInstallmentSecondDueDate,
} from "@/lib/installment-payment";
import { isSmsProviderConfigured } from "@/lib/sms";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { buildShadowLedgerEntry } from "@/lib/shadow-ledger";
import { safeErrorResponse } from "@/lib/api-errors";
import { createRouteSupabaseClient } from "@/lib/supabase-server";

// Fix (auditoría externa, verificado 2026-07-31): antes, si faltaban las
// env vars de Supabase, se usaban valores placeholder ("https://placeholder
// .supabase.co" / "placeholder") en SILENCIO -- el endpoint seguía
// arrancando y fallaba más tarde con un error de red/DNS confuso (o, peor,
// con un comportamiento indefinido) en vez de un error claro señalando la
// causa real (config faltante). Esto es el endpoint de CONFIRMACIÓN DE
// PAGO -- un fallo silencioso o confuso aquí es especialmente peligroso.
// Ahora se lanza un error explícito si faltan, igual que ya hace
// getServiceRoleClient() más abajo con SUPABASE_SERVICE_ROLE_KEY.
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
}

// v8.3 fix (auditoría 2026-07-15): capacity_slots solo tiene políticas RLS
// para "is_supervisor" (SELECT solo si is_published, ALL para supervisores;
// ver migración 026). Un cliente final autenticado normal NUNCA cumple
// is_supervisor(), así que el INSERT del slot flexible y el UPDATE de
// committed_teams de abajo fallaban silenciosamente (o el checkout entero
// se rompía) bajo el cliente de sesión del usuario. capacity_slots es
// disponibilidad operativa compartida, no un dato propiedad del cliente --
// se usa el cliente de service role SOLO para estas dos operaciones,
// después de que el resto del endpoint ya validó todo con el cliente de
// sesión normal.
function getServiceRoleClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(getSupabaseUrl(), serviceKey);
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
      useInstallmentPlan,
      walletPaymentIntentId,
    } = body;

    if (!quoteId || !serviceDate || !serviceTime || !paymentMethodId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const requestedOption: "card" | "paypal_first_time" | "alipay" | "wechat_pay" =
      paymentOption === "paypal_first_time" || paymentOption === "alipay" || paymentOption === "wechat_pay"
        ? paymentOption
        : "card";

    const supabase = createRouteSupabaseClient();
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

    const oneYearLater = new Date(vancouverToday);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    if (serviceDateObj > oneYearLater) {
      return NextResponse.json(
        { error: "Service cannot be scheduled more than 1 year in advance" },
        { status: 400 }
      );
    }

    // Regla única de "mínimo 1 día de anticipación" + "corte de las 5 PM hora
    // de Vancouver", compartida con el date-picker de la UI vía
    // checkBookingDateAllowed() (@/lib/pricing). Antes esta ruta reimplementaba
    // su propia versión de la regla por separado del date-picker, y podían
    // divergir -- el date-picker permitía elegir fechas futuras que este
    // endpoint terminaba rechazando en checkout (auditoría externa,
    // verificado 2026-08-01).
    const dateCheck = checkBookingDateAllowed(serviceDate);
    if (!dateCheck.allowed) {
      if (dateCheck.reason === "too_soon") {
        return NextResponse.json(
          { error: "Service must be scheduled at least 1 day in advance" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Bookings for tomorrow close at 5:00 PM. Please select a later date." },
        { status: 400 }
      );
    }

    // Verify quote exists and belongs to user
    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, service_subtype, service_type, square_feet, zone, price_frozen_until, total, hold_amount, address_lat, address_lng, admin_review_required, user_id, pipa_alt_requires_audit, purchase_order, client_property_id, requires_field_auditor, property_risk_tier, addon_zones, postal_code, is_gift_order")
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
      .select("account_type, services_count, preferred_languages, phone_verified, stripe_customer_id")
      .eq("user_id", quoteRow.user_id)
      .single();

    if (clientProfile?.account_type === "b2b" || clientProfile?.account_type === "government") {
      return NextResponse.json(
        { error: "Commercial / Government accounts require manual onboarding. Online booking is not available." },
        { status: 403 }
      );
    }

    // v8.3 fix (auditoría E1 2026-07-18): un cliente que entra por Google/Apple
    // nunca pasaba por verificación telefónica (AuthModal solo la exige en el
    // paso de login por SMS). Se agrega el gate autoritativo aquí -- sin
    // importar qué haga (o deje de hacer) la UI, el servidor nunca confirma
    // una reserva sin client_profiles.phone_verified = true.
    //
    // v8.3 P0-2 (auditoría Fable5, 2026-07-19): ese gate era absoluto e
    // incondicional -- y la verificación telefónica depende de un proveedor
    // de SMS (Twilio u otro) configurado en Supabase Auth
    // (supabase/config.toml -> [auth.sms.twilio], hoy `enabled = false` sin
    // credenciales). Sin proveedor, Supabase Auth NUNCA entrega el código
    // OTP, `phone_verified` nunca puede volverse true, y el gate de arriba
    // bloqueaba el 100% de las reservas -- no una degradación, un apagón
    // total del negocio. Decisión del dueño: el bloqueo se vuelve
    // CONDICIONAL a que exista un proveedor real. isSmsProviderConfigured()
    // (src/lib/sms.ts) es la única fuente de verdad de "¿hay proveedor?" en
    // todo el sistema -- se reusa aquí en vez de inventar un chequeo nuevo.
    // Si mañana el dueño configura TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN (y
    // el proveedor correspondiente en Supabase Auth), este gate vuelve a
    // exigir phone_verified automáticamente, sin tocar código de nuevo --
    // la condición se evalúa en cada request, no es un flag manual que
    // alguien deba recordar apagar.
    const smsProviderConfigured = isSmsProviderConfigured();
    if (smsProviderConfigured && !clientProfile?.phone_verified) {
      return NextResponse.json(
        {
          error: "Phone verification is required before confirming a reservation.",
          code: "PHONE_VERIFICATION_REQUIRED",
        },
        { status: 403 }
      );
    }

    // Reserva completada SIN verificación telefónica porque no hay
    // proveedor de SMS -- no debe desaparecer en silencio (P0-3 ya
    // documenta que las comunicaciones salientes son silenciosas por
    // diseño; esto es exactamente el tipo de brecha que la bandeja
    // unificada de alertas (E0.6, migración 147) existe para exponer).
    // publishUnifiedAlert nunca lanza -- un fallo al insertar la alerta no
    // debe bloquear la reserva real del cliente, que es la acción
    // principal de este endpoint.
    if (!smsProviderConfigured && !clientProfile?.phone_verified) {
      const alertClient = getServiceRoleClient();
      if (alertClient) {
        await publishUnifiedAlert(alertClient, {
          sourceModule: "phone_verification_bypass",
          sourceTable: "quotes",
          sourceId: quoteId,
          tier: "can_wait",
          severity: "p2_automatic",
          title: "Reserva completada sin verificación telefónica (sin proveedor de SMS)",
          summary:
            "No hay proveedor de SMS configurado (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN ausentes). Esta reserva se confirmó sin verificar el teléfono del cliente. Configura un proveedor de SMS para que la verificación vuelva a exigirse automáticamente.",
        });
      } else {
        console.warn(
          "stripe/confirm: reserva confirmada sin verificación telefónica (sin proveedor SMS) y SUPABASE_SERVICE_ROLE_KEY no configurada -- no se pudo publicar la alerta unificada.",
          { quoteId }
        );
      }
    }

    // Validar opción de pago: PayPal solo para primer servicio.
    // v8.3 fix (auditoría E2 2026-07-18): "primer servicio" se basaba en
    // service_subtype === "first_time" (una etiqueta elegida por el cliente
    // al cotizar, no un hecho verificado) además de services_count === 0.
    // Un cliente recurrente podía volver a elegir/forzar el subtipo
    // "first_time" en una cotización nueva y reactivar la opción PayPal
    // reservada para primera vez. Ahora se basa ÚNICAMENTE en el historial
    // real verificado server-side: client_profiles.services_count, que solo
    // se incrementa cuando una orden anterior de ese cliente se completó
    // (ver increment_client_services_count en
    // supabase/migrations/027_modulo2_payment_flow_fixes.sql, invocada desde
    // src/app/api/employee/service/route.ts al cerrar la orden).
    const isFirstTimeService = clientProfile?.services_count === 0;

    if (requestedOption === "paypal_first_time" && !isFirstTimeService) {
      return NextResponse.json(
        { error: "PayPal is only available for first-time services. Please use card." },
        { status: 400 }
      );
    }

    const selectedPaymentOption: "card" | "paypal_first_time" | "alipay" | "wechat_pay" = requestedOption;

    // SetupIntent de Stripe es obligatorio en TODAS las opciones (spec v8.2,
    // extendido 2026-07-21 a Alipay/WeChat Pay: aunque esos medios ya cobran
    // el 100% por adelantado, la tarjeta de respaldo sigue siendo necesaria
    // para cargos extra reales -- daño, tiempo adicional, cancelación tardía).
    if (!stripeSetupIntentId) {
      return NextResponse.json(
        { error: "Card registration is required for all reservations, including PayPal/Alipay/WeChat Pay first service." },
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

    // Fix CRÍTICO (auditoría externa de integridad financiera, 2026-08-02):
    // el bloqueo de la quote (UPDATE quotes SET status='reserved') vivía
    // DESPUÉS de crear la orden y verificar/procesar el pago (ver más abajo,
    // donde antes solo se emitía una alerta P1 si ese UPDATE fallaba). Si el
    // UPDATE fallaba, la quote seguía en 'pending' con una orden ya creada y
    // pagada -- un segundo checkout concurrente sobre la MISMA quote podía
    // pasar todos los checks de arriba (que no verifican quoteRow.status) y
    // crear una SEGUNDA orden real sobre el mismo presupuesto. Fix: el
    // bloqueo se mueve aquí, ANTES de tocar Stripe/PayPal y ANTES de crear la
    // orden, usando compare-and-swap (UPDATE ... WHERE status='pending').
    // Si el CAS afecta 0 filas, alguien más (otro request concurrente, u otro
    // estado ya asignado a esta quote) ya la reservó -- se aborta aquí, antes
    // de cualquier efecto secundario real (Stripe, PayPal, orden), devolviendo
    // un error claro en vez de seguir adelante.
    const { data: casRows, error: casError } = await supabase
      .from("quotes")
      .update({ status: "reserved" })
      .eq("id", quoteId)
      .eq("status", "pending")
      .select("id");

    if (casError) {
      console.error(`CRITICAL: fallo al intentar bloquear (CAS) la quote ${quoteId} antes de procesar el pago:`, casError);
      return NextResponse.json(
        { error: "Unable to reserve this quote. Please try again." },
        { status: 500 }
      );
    }

    if (!casRows || casRows.length !== 1) {
      // 0 filas afectadas: la quote ya no está en 'pending' (ya fue
      // reservada por otro request concurrente, o está en otro estado).
      // Nunca se llegó a tocar Stripe/PayPal ni a crear una orden.
      return NextResponse.json(
        { error: "This quote has already been reserved or is no longer available. Please generate a new quote." },
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
    // Fix 2026-07-24 (detectado en QA manual / auditoría externa): TODA
    // reserva con PayPal primer servicio se rechazaba con 400 "Payment
    // method mismatch", sin excepción. Causa: para payment_option ===
    // "paypal_first_time" no se renderiza StripeCardForm (no hay tarjeta
    // principal que tokenizar), así que la UI (reserva/[quoteId]/page.tsx)
    // hace setPaymentMethodId("paypal") -- un string literal fijo, nunca un
    // PaymentMethod real de Stripe (formato pm_xxx). El SetupIntent creado
    // al cargar la página SÍ es real y SÍ se usa, pero solo para registrar
    // la tarjeta de respaldo obligatoria (daño, tiempo extra, cancelación
    // tardía) -- su payment_method nunca fue pensado para coincidir con el
    // string "paypal". Comparar ambos aquí incondicionalmente garantizaba
    // el rechazo del 100% de las reservas PayPal. Para "card", "alipay" y
    // "wechat_pay" el paymentMethodId SÍ es un PaymentMethod real (viene de
    // StripeCardForm, adjunto al mismo SetupIntent), así que ahí la
    // comparación exacta se mantiene sin relajar -- es la única forma de
    // verificar que la tarjeta que el cliente completó es la misma que
    // quedó registrada en el SetupIntent verificado arriba.
    if (selectedPaymentOption !== "paypal_first_time" && setupIntent.payment_method !== paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method mismatch. Please try again." },
        { status: 400 }
      );
    }

    // v8.3 fix (auditoría E1 2026-07-18): la dirección de facturación
    // (código postal capturado por Stripe en StripeCardForm.tsx, verificado
    // vía AVS por la red de la tarjeta) nunca se comparaba contra el código
    // postal del SERVICIO (quoteRow.postal_code) -- una tarjeta robada/de
    // fraude con billing address en otra ciudad/provincia pasaba sin ningún
    // chequeo. No se bloquea la reserva por esto (falsos positivos son
    // comunes -- tarjeta de un familiar, tarjeta corporativa, o
    // is_gift_order = true cuando exista ese flujo): se compara por FSA
    // (los primeros 3 caracteres del código postal canadiense, que es la
    // granularidad real que AVS de Stripe/Visa/Mastercard valida para
    // Canadá) y, si no coincide, se marca la orden para revisión manual en
    // vez de fallar silenciosamente sin chequeo alguno.
    let billingPostalCode: string | null = null;
    let billingAvsMismatch = false;
    const skipAvsCheck =
      clientProfile?.account_type === "b2b" ||
      clientProfile?.account_type === "government" ||
      quoteRow.is_gift_order === true;

    if (!skipAvsCheck) {
      try {
        const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
        billingPostalCode = paymentMethod.billing_details?.address?.postal_code ?? null;
        const servicePostalCode = quoteRow.postal_code as string | null;

        if (billingPostalCode && servicePostalCode) {
          const normalizedBilling = billingPostalCode.replace(/\s/g, "").toUpperCase().slice(0, 3);
          const normalizedService = servicePostalCode.replace(/\s/g, "").toUpperCase().slice(0, 3);
          billingAvsMismatch = normalizedBilling !== normalizedService;
        }
      } catch (avsErr) {
        // Nunca bloquear la reserva porque Stripe no pudo devolver la
        // billing_details -- solo queda sin verificar (no se marca mismatch
        // sin evidencia).
        console.error("AVS billing postal code check failed:", avsErr);
      }
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

    // Alipay/WeChat Pay (feature 2026-07-21): verificar el PaymentIntent
    // real contra la API de Stripe -- a diferencia de PayPal (transacción
    // externa, verificada por su propia API vía verifyPayPalTransaction),
    // esto ya es un PaymentIntent de Stripe creado por /api/stripe/wallet-intent
    // y confirmado en el navegador del cliente (redirect de Alipay / QR de
    // WeChat Pay). Nunca se confía en un monto del cliente: se compara
    // contra el total server-side de la quote, igual que el resto del route.
    let walletAmountCollectedCents = 0;
    if (selectedPaymentOption === "alipay" || selectedPaymentOption === "wechat_pay") {
      if (!walletPaymentIntentId) {
        return NextResponse.json(
          { error: "Missing wallet payment confirmation" },
          { status: 400 }
        );
      }

      // Evitar reutilización del mismo PaymentIntent en otra orden (mismo
      // patrón anti-reuso que paypal_transaction_id arriba; el índice único
      // parcial de la migración 241 es la última línea de defensa).
      const { data: existingWalletOrder } = await supabase
        .from("orders")
        .select("id")
        .eq("wallet_payment_intent_id", walletPaymentIntentId)
        .neq("status", "cancelled")
        .maybeSingle();

      if (existingWalletOrder) {
        return NextResponse.json(
          { error: "This payment has already been used for another order" },
          { status: 409 }
        );
      }

      let walletPi;
      try {
        walletPi = await stripe.paymentIntents.retrieve(walletPaymentIntentId);
      } catch (err) {
        console.error("Failed to retrieve wallet PaymentIntent:", err);
        return NextResponse.json(
          { error: "Could not verify payment. Please try again." },
          { status: 402 }
        );
      }

      const expectedAmountCents = dollarsToCents(Number(quoteRow.total));

      if (walletPi.status !== "succeeded") {
        return NextResponse.json(
          { error: `Payment not completed (status: ${walletPi.status}). Please complete payment before confirming.` },
          { status: 402 }
        );
      }
      if (walletPi.currency !== "cad" || walletPi.amount !== expectedAmountCents) {
        return NextResponse.json(
          { error: "Payment amount does not match the quote total" },
          { status: 402 }
        );
      }
      if (walletPi.metadata?.quote_id !== quoteId) {
        return NextResponse.json(
          { error: "Payment does not match this reservation" },
          { status: 402 }
        );
      }

      walletAmountCollectedCents = walletPi.amount_received || walletPi.amount;
    }

    // En el flujo corregido NO autorizamos el hold en la confirmación.
    // El cron /api/cron/hold-authorize lo hará T-72h antes del servicio.
    // Esto evita que los holds expiren para servicios lejanos y cumple el spec.

    // Verificar capacidad real: el slot debe existir, estar publicado y tener cupo
    const capacityClient = getServiceRoleClient();
    if (!capacityClient) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    let slotRow;
    const { data: slotData, error: slotError } = await capacityClient
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
      // Limitación conocida, documentada 2026-07-24 (auditoría externa,
      // revisada junto con el fix de sobreventa de arriba): estos 30
      // minutos fijos NO reflejan la duración real estimada del servicio
      // cotizado -- src/lib/pricing.ts sí calcula una estimación real
      // (HHE -> getEstimatedServiceMinutes / hheMinutes dentro de
      // calculateTeamRequirements, usado para dimensionar equipos y tiempo
      // bloqueado AL MOMENTO DE COTIZAR), pero ese resultado nunca se
      // persiste en la tabla `quotes` ni se selecciona en `quoteRow` aquí --
      // no existe ningún estimatedDurationMinutes/estimatedHours en el
      // objeto de la cotización disponible en este endpoint. Recomputarlo
      // aquí requeriría un fetch adicional de la tabla HHE vigente
      // (getCurrentHHETable, la misma llamada async que hace /api/quote) y
      // podría no coincidir con la tabla HHE que se usó realmente al
      // cotizar (que ya pudo cambiar desde entonces) -- eso es un cambio de
      // mayor alcance (nueva columna persistida en `quotes`, no solo lógica
      // de este endpoint) y queda fuera de este fix, que se limita al bug de
      // atomicidad/sobreventa de arriba, el más grave de los dos. No
      // inventar aquí un cálculo nuevo sin ese diseño.
      const [h, m] = serviceTime.split(":").map(Number);
      const endH = h + Math.floor((m + 30) / 60);
      const endM = (m + 30) % 60;
      const { data: createdSlot, error: createSlotError } = await capacityClient
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

    // Fix 2026-07-24 (auditoría externa, sobreventa de capacidad confirmada
    // -- dinero real): el chequeo anterior aquí ("slotAvailable" leído en
    // memoria, sin lock) y el INSERT completo de la orden más abajo estaban
    // separados por un INSERT de orden entero, con el UPDATE de
    // committed_teams recién DESPUÉS de crear la orden. Dos requests
    // concurrentes podían ambos leer "hay espacio" aquí, ambos crear su
    // orden, y aunque el UPDATE posterior tenía optimistic lock (evitaba que
    // el CONTADOR se corrompiera), no evitaba que AMBAS órdenes quedaran
    // confirmadas en un slot con cupo para solo una -- sobreventa real.
    //
    // Fix: reservar el cupo de forma ATÓMICA (SELECT ... FOR UPDATE +
    // verificación + incremento, todo en una transacción de Postgres) ANTES
    // de tocar la tabla `orders`, con el mismo patrón ya usado para
    // client_wallets (apply_wallet_delta, migraciones 180/233). Si el RPC
    // confirma que no hay espacio, se aborta AQUÍ, antes de crear ninguna
    // orden -- nunca se llega a tener una orden pagada sin capacidad real.
    // Ver supabase/migrations/242_fix_capacity_slot_overselling_atomic_rpc.sql.
    const { data: commitData, error: commitError } = await capacityClient.rpc(
      "commit_capacity_slot",
      { p_slot_id: slotRow.id, p_teams_needed: 1 }
    );

    if (commitError) {
      console.error(`commit_capacity_slot RPC failed for slot ${slotRow.id} (quote ${quoteId}):`, commitError);
      return NextResponse.json(
        { error: "Unable to reserve selected time slot. Please try again." },
        { status: 500 }
      );
    }

    const commitResult = Array.isArray(commitData) ? commitData[0] : commitData;
    if (!commitResult?.success) {
      return NextResponse.json(
        { error: "This time slot just filled up, please choose another." },
        { status: 409 }
      );
    }

    // v8.3 E2.10 -- pago fraccionado 50/50, solo elegible para total > $500 y
    // solo si el cliente lo pidió explícitamente. Ver limitación documentada
    // en src/lib/installment-payment.ts: esto es metadata declarada, el
    // cobro real sigue el flujo Hold+Batch existente sin modificarse aquí.
    const quoteTotalCents = dollarsToCents(Number(quoteRow.total));
    const installmentRequested = useInstallmentPlan === true && isEligibleForInstallmentPlan(quoteTotalCents);
    const installmentSplit = installmentRequested ? computeInstallmentSplit(quoteTotalCents) : null;
    const installmentSecondDueAt = installmentRequested
      ? computeInstallmentSecondDueDate(serviceDatetime.toISOString(), new Date().toISOString())
      : null;

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
        // v0.1 fix: si el cliente no envía el customer_id, usar el del perfil
        // (fuente canónica 1:1). Evita customers duplicados en Stripe.
        stripe_customer_id: stripeCustomerId || clientProfile?.stripe_customer_id || null,
        stripe_payment_method_id: paymentMethodId,
        stripe_setup_intent_id: stripeSetupIntentId,
        payment_option: selectedPaymentOption,
        paypal_transaction_id: selectedPaymentOption === "paypal_first_time" ? paypalTransactionId || null : null,
        paypal_payer_email: selectedPaymentOption === "paypal_first_time" ? paypalPayerEmail || null : null,
        paypal_advance_amount: selectedPaymentOption === "paypal_first_time" ? paypalAdvanceAmount : 0,
        wallet_payment_intent_id:
          selectedPaymentOption === "alipay" || selectedPaymentOption === "wechat_pay"
            ? walletPaymentIntentId
            : null,
        wallet_amount_collected_cents:
          selectedPaymentOption === "alipay" || selectedPaymentOption === "wechat_pay"
            ? walletAmountCollectedCents
            : 0,
        // Fix (auditoría externa 2026-07-24, dinero real confirmado): este
        // INSERT seteaba wallet_amount_collected_cents arriba, pero NUNCA
        // total_paid_cents -- la columna que TODO el resto del sistema
        // (admin/accounting, cron/qbo-sync, client-segments, etc.) lee como
        // "cuánto se cobró realmente" de una orden (ver RAÍZ-3, migración
        // 229). Resultado: el 100% cobrado por adelantado vía Alipay/WeChat
        // Pay quedaba invisible para toda la contabilidad, aunque sí se
        // cobró de verdad en Stripe (walletAmountCollectedCents, verificado
        // arriba) y quedó registrado en wallet_amount_collected_cents y en
        // shadow_ledger_entries. Se setea aquí en la misma escritura,
        // siguiendo el mismo criterio que ya usan los demás payment_option:
        // 'card' deja total_paid_cents en 0 hasta que el hold se capture
        // (cron batch-capture), y 'paypal_first_time' registra el anticipo
        // real ya cobrado (paypal_advance_amount) por su propio camino
        // (shadow ledger) sin tocar total_paid_cents hasta ese mismo cron.
        // Alipay/WeChat Pay, a diferencia de ambos, cobra el 100% de una
        // sola vez y de forma síncrona ANTES de este INSERT (verificado
        // arriba contra la API de Stripe), así que no hay motivo para
        // esperar a un cron: total_paid_cents = walletAmountCollectedCents
        // desde el momento en que la orden nace.
        total_paid_cents:
          selectedPaymentOption === "alipay" || selectedPaymentOption === "wechat_pay"
            ? walletAmountCollectedCents
            : 0,
        // RAÍZ-3 (2026-07-21, migración 229): orders.hold_amount_cents está en
        // centavos; holdAmount (derivado de quotes.hold_amount, dólares) se
        // escala x100 al escribirlo aquí. hold_authorized_amount_cents nace en
        // 0 igual que antes (se autoriza recién en el cron T-72h).
        hold_amount_cents: dollarsToCents(holdAmount),
        hold_authorized_amount_cents: 0,
        cancellation_window_hours: 72,
        billing_postal_code: billingPostalCode,
        billing_avs_mismatch: billingAvsMismatch,
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
        // v8.3 E2.10: pago fraccionado 50/50 (metadata, ver nota arriba).
        installment_plan_selected: installmentRequested,
        installment_first_amount_cents: installmentSplit?.firstInstallmentCents ?? null,
        installment_second_amount_cents: installmentSplit?.secondInstallmentCents ?? null,
        installment_second_due_at: installmentSecondDueAt,
      })
      .select()
      .single();

    if (billingAvsMismatch) {
      console.warn(
        `AVS mismatch on order for quote ${quoteId}: billing postal code area does not match service postal code area. Flagged for manual review (orders.billing_avs_mismatch).`
      );
    }

    if (orderError) {
      console.error("Order insert error:", orderError);
      // Fix 2026-07-24 (auditoría externa, mismo fix de sobreventa de
      // arriba): el cupo del slot ya se comprometió atómicamente vía
      // commit_capacity_slot ANTES de este INSERT. Si la orden termina sin
      // poder crearse igual (ej. constraint distinta, error transitorio de
      // red), ese cupo quedaría comprometido "fantasma" sin ninguna orden
      // real detrás -- se libera aquí, best-effort, con el mismo patrón de
      // "loguear y no bloquear la respuesta de error real al cliente" que ya
      // usa el resto de este archivo (shadow ledger, dispatchCommunication).
      const { error: releaseError } = await capacityClient.rpc("release_capacity_slot", {
        p_slot_id: slotRow.id,
        p_teams_to_release: 1,
      });
      if (releaseError) {
        console.error(
          `release_capacity_slot RPC failed after order insert error for slot ${slotRow.id} (quote ${quoteId}) -- capacity may be stranded, needs manual reconciliation:`,
          releaseError
        );
        // Fix (auditoría 2026-08-06): si el release de capacidad falla,
        // el slot queda permanentemente reservado sin orden real —
        // requiere intervención manual. Se publica alerta unificada
        // p1_urgent para que ops lo vea en la bandeja de alertas.
        publishUnifiedAlert(capacityClient, {
          sourceModule: "stripe_confirm_stranded_capacity",
          sourceTable: "capacity_slots",
          sourceId: slotRow.id,
          tier: "respond_10min",
          severity: "p1_urgent",
          title: "Capacidad varada tras error de creación de orden",
          summary: `Slot ${slotRow.id} no pudo liberarse tras fallo de INSERT de orden para quote ${quoteId}. Requiere reconciliación manual.`,
        }).catch(() => {
          // Fire-and-forget: no bloquear la respuesta de error al cliente
        });
      }
      // La quote ya fue bloqueada (CAS -> 'reserved') ANTES de este INSERT,
      // pero ninguna orden real llegó a crearse -- revertir a 'pending' para
      // que el cliente pueda reintentar el checkout sobre la misma quote en
      // vez de quedar "reservada" para siempre sin ninguna orden detrás.
      const { error: revertError } = await supabase
        .from("quotes")
        .update({ status: "pending" })
        .eq("id", quoteId)
        .eq("status", "reserved");
      if (revertError) {
        console.error(
          `CRITICAL: fallo al revertir quote ${quoteId} a 'pending' tras error de INSERT de orden -- la quote puede quedar bloqueada indefinidamente, requiere corrección manual:`,
          revertError
        );
      }
      // Fix (auditoría 2026-08-06): orderError.message exponía detalles
      // internos de la DB (nombres de tabla, constraints, columnas) al
      // cliente. Se reemplaza con safeErrorResponse que solo devuelve un
      // mensaje genérico al cliente y loguea el error real internamente.
      return safeErrorResponse(orderError, 500, "Ocurrió un error al crear la orden");
    }

    // Fix F4 (auditoría operativa/contable 2026-07-21, verificado y
    // confirmado real): el anticipo de PayPal (paypal_advance_amount) se
    // guardaba en `orders`, pero nunca se registraba en shadow_ledger_entries
    // -- el propio docstring de shadow-ledger.ts ya documentaba "anticipo
    // PayPal (hold-authorize)" como uno de los eventos de dinero real que
    // DEBEN loguearse, pero ningún caller lo hacía. Sin esto, el dinero real
    // ya cobrado por PayPal quedaba invisible para la reconciliación interna
    // (replayOrderBalance) y para el futuro job de conciliación QBO.
    if (selectedPaymentOption === "paypal_first_time" && paypalAdvanceAmount > 0) {
      try {
        await supabase.from("shadow_ledger_entries").insert(
          buildShadowLedgerEntry({
            eventType: "paypal_advance_received",
            orderId: order.id,
            userId: user.id,
            amountCents: dollarsToCents(paypalAdvanceAmount),
            processor: "paypal",
            externalReference: paypalTransactionId || null,
            occurredAt: new Date(),
            metadata: { source: "stripe_confirm_route" },
          })
        );
      } catch (shadowLedgerErr) {
        // El anticipo de PayPal ya fue verificado y la orden ya existe --
        // un fallo al registrar el shadow ledger no debe bloquear la
        // reserva del cliente, pero sí queda logueado para reconciliación
        // manual (mismo patrón que el resto del archivo).
        console.error(`Shadow ledger insert failed for PayPal advance on order ${order.id}:`, shadowLedgerErr);
      }
    }

    // Alipay/WeChat Pay: registrar el cobro completo real (100% del total)
    // en Shadow Ledger, mismo patrón/razón que el anticipo PayPal arriba.
    if (
      (selectedPaymentOption === "alipay" || selectedPaymentOption === "wechat_pay") &&
      walletAmountCollectedCents > 0
    ) {
      try {
        await supabase.from("shadow_ledger_entries").insert(
          buildShadowLedgerEntry({
            eventType: "wallet_full_payment_received",
            orderId: order.id,
            userId: user.id,
            amountCents: walletAmountCollectedCents,
            processor: "stripe",
            externalReference: walletPaymentIntentId,
            occurredAt: new Date(),
            metadata: { source: "stripe_confirm_route", paymentOption: selectedPaymentOption },
          })
        );
      } catch (shadowLedgerErr) {
        console.error(`Shadow ledger insert failed for wallet payment on order ${order.id}:`, shadowLedgerErr);
      }
    }

    // Nota (auditoría externa de integridad financiera, 2026-08-02): la
    // quote ya fue bloqueada como 'reserved' vía CAS ANTES de procesar el
    // pago y crear la orden (ver arriba, antes de `const stripe =
    // assertStripe()`). Ya no hace falta un segundo UPDATE aquí -- ese era
    // precisamente el bug: el bloqueo ocurría DESPUÉS de crear la orden y
    // procesar el pago, dejando una ventana donde un fallo en el UPDATE
    // permitía una segunda orden sobre la misma quote.

    // Fix 2026-07-24 (auditoría externa): el UPDATE de committed_teams con
    // optimistic lock que vivía aquí (DESPUÉS del INSERT de la orden) se
    // eliminó -- ya no hace falta. El cupo del slot ahora se reserva de
    // forma atómica ANTES del INSERT de la orden, vía el RPC
    // commit_capacity_slot (ver arriba, cerca del chequeo de disponibilidad
    // del slot). Ese RPC es lo que realmente cierra la ventana de carrera
    // TOCTOU que este UPDATE posterior solo detectaba después de que el
    // daño (una orden pagada sin capacidad real) ya podía haber ocurrido.

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
        "en") as "en" | "zh" | "fr";

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
    return safeErrorResponse(err);
  }
}

"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Elements } from "@stripe/react-stripe-js";
import { QuoteData } from "@/types";
import { supabase } from "@/lib/supabase";
import { mapQuoteFromSupabase } from "@/lib/supabase-mappers";
import { DatePicker } from "@/components/reserva/DatePicker";
import { TimeSlotPicker } from "@/components/reserva/TimeSlotPicker";
import { StripeCardForm } from "@/components/reserva/StripeCardForm";
import { SavedCardSelector } from "@/components/reserva/SavedCardSelector";
import { ApplePayButton } from "@/components/reserva/ApplePayButton";
import { WalletPayButton } from "@/components/reserva/WalletPayButton";
import { ReservationSummary } from "@/components/reserva/ReservationSummary";
import { CheckoutBenefitsPanel } from "@/components/reserva/CheckoutBenefitsPanel";
import { PriceFreezeCountdown } from "@/components/reserva/PriceFreezeCountdown";
import { AuthModal } from "@/components/cotizador/AuthModal";
import {
  ChevronLeft,
  Shield,
  Calendar,
  CreditCard,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// Fix (auditoría en vivo 2026-08-01): antes importaba getStripe desde "@/lib/stripe",
// que también contiene el SDK de servidor de Stripe y el console.warn de STRIPE_SECRET_KEY.
// Como esta página es "use client", Next.js empaquetaba todo ese módulo en el bundle del
// navegador, donde STRIPE_SECRET_KEY siempre es undefined (no es NEXT_PUBLIC_) -> disparaba
// una falsa alarma en la consola en cada carga de /reserva. Ya existía "@/lib/stripe-client"
// (100% seguro para el cliente, solo usa la publishable key) pero nunca se conectó aquí.
import { getStripe } from "@/lib/stripe-client";

const stripePromise = getStripe();

// Fix (revisión 2026-07-30, punto 3): antes exigía exactamente 17 caracteres,
// pero src/app/api/stripe/confirm/route.ts (fuente de verdad del backend)
// acepta 12-20 alfanuméricos -- un Transaction ID real de PayPal fuera de 17
// exactos era rechazado aquí antes de siquiera llegar al backend. Se unifica
// al mismo regex que usa el backend.
const PAYPAL_TRANSACTION_ID_RE = /^[A-Za-z0-9]{12,20}$/;
const PAYPAL_TRANSACTION_ID_MAX_LENGTH = 20;

export default function ReservaPage() {
  const t = useTranslations("reserva");
  const router = useRouter();
  const params = useParams();
  const quoteId = params?.quoteId as string;

  // Fix (auditoría externa, hallazgo A11): antes se leía el locale de
  // `window.location.pathname` en el primer render, lo que causaba hydration
  // mismatch (el server-render no tiene `window` y usaba "en" como
  // fallback, mientras el cliente podía resolver otro locale en el mismo
  // ciclo) -- HTML distinto entre servidor y cliente. `useParams()` de
  // next/navigation ya se usaba para `quoteId`; esta ruta también tiene
  // `[locale]` como segmento dinámico, así que se lee del mismo hook,
  // consistente entre servidor y cliente.
  const locale = (params?.locale as string) || "en";
  const safeLocale = ["en", "zh", "fr"].includes(locale) ? locale : "en";

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [serviceDate, setServiceDate] = useState("");
  const [serviceTime, setServiceTime] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paymentOption, setPaymentOption] = useState<"card" | "paypal_first_time" | "alipay" | "wechat_pay">("card");
  const [paypalTransactionId, setPaypalTransactionId] = useState("");
  const [paypalPayerEmail, setPaypalPayerEmail] = useState("");
  // Feature 2026-07-21: Alipay/WeChat Pay cobran el 100% por adelantado vía
  // un PaymentIntent real de Stripe (ver WalletPayButton.tsx). El cliente
  // igual debe registrar una tarjeta de respaldo (paymentMethodId, arriba)
  // antes de poder confirmar -- ambas condiciones se exigen en handleConfirm.
  const [walletPaymentIntentId, setWalletPaymentIntentId] = useState("");
  const [usingNewCard, setUsingNewCard] = useState(false);
  // Fix (auditoría 2026-07-30): Alipay diferido (y en general cualquier
  // wallet payment con 3DS/verificación adicional) puede volver del redirect
  // con redirect_status="processing" o "requires_action" en vez de
  // "succeeded". Antes esos casos caían al else implícito más abajo, el
  // querystring se limpiaba igual, y el cliente se quedaba sin
  // walletPaymentIntentId ni ningún aviso -- no sabía si su pago se había
  // perdido o seguía en curso. Este estado guarda ese resultado intermedio
  // para mostrar un mensaje explícito.
  const [walletRedirectStatus, setWalletRedirectStatus] = useState<
    "" | "processing" | "requires_action"
  >("");
  const [stripeClientSecret, setStripeClientSecret] = useState("");
  const [stripeCustomerId, setStripeCustomerId] = useState("");
  const [stripeSetupIntentId, setStripeSetupIntentId] = useState("");
  // v8.3 fix (auditoría 2026-07-15): antes un fallo de /api/stripe/setup-intent
  // (Stripe caído, quote ya reservada en otra pestaña -> 409, etc.) solo
  // hacía console.error -- la UI mostraba "Preparing secure checkout..."
  // indefinidamente, sin botón de reintento ni mensaje, justo en el paso
  // más crítico del embudo (pago).
  const [setupIntentError, setSetupIntentError] = useState("");
  const [setupIntentRetryKey, setSetupIntentRetryKey] = useState(0);
  // Fix 2026-07-24 (auditoría reserva/checkout): el useEffect de más abajo
  // que crea el SetupIntent hacía `if (!user) return;` en silencio cuando el
  // cliente elegía fecha/hora sin sesión activa (p.ej. llegó directo a un
  // link de cotización, o su sesión expiró). stripeClientSecret nunca se
  // fijaba, y el bloque "Preparing secure checkout..." (más abajo) quedaba
  // girando para siempre sin explicar nada ni ofrecer login -- el cliente
  // quedaba varado en el paso más crítico del embudo. Ahora se muestra el
  // mismo AuthModal ya usado para forcePhoneVerification, sin perder
  // serviceDate/serviceTime seleccionados, y tras loguearse se reintenta la
  // creación del SetupIntent automáticamente (setupIntentRetryKey).
  const [needsAuthForCheckout, setNeedsAuthForCheckout] = useState(false);
  const [recalculateError, setRecalculateError] = useState("");
  const [priceFreezeExpired, setPriceFreezeExpired] = useState(false);

  // Si la quote se refresca (p.ej. tras recalculateQuote) con un freeze
  // nuevo, no debe seguir mostrándose como expirada.
  useEffect(() => {
    setPriceFreezeExpired(false);
  }, [quote?.priceFrozenUntil]);
  // Feature 2026-07-21: Alipay hace un redirect completo fuera de la página
  // y Stripe vuelve con ?payment_intent=...&redirect_status=succeeded en el
  // querystring (return_url = la misma URL de esta página, ver
  // WalletPayButton.tsx). Al montar, si esos params están presentes y el
  // pago se completó, se restaura walletPaymentIntentId y se selecciona
  // Alipay para que el cliente vea el estado ya confirmado y siga con el
  // registro de la tarjeta de respaldo.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const returnedPi = params.get("payment_intent");
    const redirectStatus = params.get("redirect_status");
    if (!returnedPi || !redirectStatus) return;

    if (redirectStatus === "succeeded") {
      setPaymentOption("alipay");
      setWalletPaymentIntentId(returnedPi);
    } else if (redirectStatus === "processing" || redirectStatus === "requires_action") {
      // Fix (auditoría 2026-07-30): capturamos explícitamente estos estados
      // en vez de dejarlos caer al else -- no fijamos walletPaymentIntentId
      // (el pago NO está confirmado todavía) pero sí mostramos el aviso de
      // "confirmando con tu proveedor" para que el cliente no crea que su
      // pago se perdió, y ofrecemos reintentar el pago desde cero.
      setPaymentOption("alipay");
      setWalletRedirectStatus(redirectStatus);
    }
    // Limpiar el querystring para no reprocesar en un refresh posterior
    // (aplica a todo redirect_status conocido -- el resultado ya quedó
    // capturado arriba en el estado de React).
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  // v8.3 fix (auditoría E2 2026-07-18): PayPal "solo primera reserva" debe
  // basarse en el historial REAL del cliente (client_profiles.services_count,
  // que solo se incrementa al completar una orden anterior), no en
  // quote.serviceSubtype -- una etiqueta elegida por el cliente al cotizar
  // que un cliente recurrente podía volver a marcar como "first_time" para
  // reactivar la opción. El servidor (stripe/confirm) ya valida esto de
  // forma autoritativa; este estado solo controla si el botón se muestra.
  const [isFirstTimeClient, setIsFirstTimeClient] = useState(false);

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [needsPhoneVerification, setNeedsPhoneVerification] = useState(false);

  // Fetch quote from Supabase and map snake_case → camelCase
  useEffect(() => {
    async function loadQuote() {
      if (!quoteId) {
        setError(t("loadError.invalidQuoteId"));
        setLoading(false);
        return;
      }

      // v8.3 E1: blindaje DB — leer de la vista quotes_client_view (migración 056),
      // que estructuralmente solo tiene las columnas permitidas al cliente
      // (defensa en profundidad: aunque este select fuera "*", no puede filtrar
      // client_score, estimated_labor_cost, admin_review_reason, etc.)
      const { data, error: supaError } = await supabase
        .from("quotes_client_view")
        .select("*")
        .eq("id", quoteId)
        .single();

      if (supaError || !data) {
        setError(t("loadError.quoteNotFound"));
        setLoading(false);
        return;
      }

      // Check price freeze
      const frozenUntil = new Date(data.price_frozen_until);
      if (frozenUntil < new Date()) {
        setError(t("loadError.quoteExpired"));
        setLoading(false);
        return;
      }

      // Check quote is still pending (not already reserved)
      if (data.status !== "pending") {
        const statusLabel =
          data.status === "reserved"
            ? t("loadError.statusLabels.reserved")
            : data.status === "expired"
            ? t("loadError.statusLabels.expired")
            : data.status;
        setError(t("loadError.alreadyStatus", { status: statusLabel }));
        setLoading(false);
        return;
      }

      // Map snake_case fields from Supabase to camelCase QuoteData
      const mapped = mapQuoteFromSupabase(data);

      // Bloquear reservas que requieren revisión administrativa o B2B/Gob
      if (mapped.adminReviewRequired) {
        setError(t("loadError.adminReviewRequired"));
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("client_profiles")
        .select("account_type, services_count, phone_verified")
        .eq("user_id", data.user_id)
        .single();

      if (profile?.account_type === "b2b" || profile?.account_type === "government") {
        setError(t("loadError.commercialAccount"));
        setLoading(false);
        return;
      }

      setIsFirstTimeClient(profile?.services_count === 0);

      // v8.3 fix (auditoría E1 2026-07-18): defensa en profundidad -- si un
      // cliente llega aquí (p.ej. link guardado) sin haber verificado su
      // teléfono (típico de login social Google/Apple), se bloquea con el
      // mismo paso obligatorio que /cotizador. El servidor (/api/stripe/confirm)
      // también rechaza esto de forma autoritativa aunque la UI fallara.
      //
      // v8.3 P0-2 (auditoría Fable5): este bloqueo ahora es CONDICIONAL a que
      // exista un proveedor de SMS real -- sin proveedor, Supabase Auth OTP
      // nunca puede entregar un código, así que phone_verified nunca podría
      // volverse true y este modal (sin botón de cerrar) dejaría al cliente
      // atorado para siempre. /api/system/sms-status expone el mismo chequeo
      // que ya usa /api/stripe/confirm (isSmsProviderConfigured()).
      let smsConfigured = true;
      try {
        const statusRes = await fetch("/api/system/sms-status");
        const statusData = await statusRes.json();
        smsConfigured = Boolean(statusData?.configured);
      } catch {
        // Si el chequeo falla, se asume que SÍ hay proveedor (falla cerrado
        // hacia el comportamiento MÁS estricto -- exigir verificación --
        // nunca hacia dejar pasar reservas sin verificar por un error de red).
        smsConfigured = true;
      }
      setNeedsPhoneVerification(smsConfigured && !profile?.phone_verified);

      setQuote(mapped);

      // Verificar feature flag de PayPal
      const { data: flag } = await supabase
        .from("feature_flags")
        .select("activo")
        .eq("nombre", "paypal_first_service_enabled")
        .single();
      setPaypalEnabled(!!flag?.activo);

      setLoading(false);
    }

    loadQuote();
  }, [quoteId, t]);

  // Recalcular precio server-side cuando cambia la fecha (weekend surcharge)
  useEffect(() => {
    const controller = new AbortController();

    async function recalculateQuote() {
      if (!serviceDate || !quote) return;

      // Calcular día esperado para evitar loop tras actualizar la quote
      const selectedDate = new Date(`${serviceDate}T00:00:00`);
      if (isNaN(selectedDate.getTime())) return;
      const expectedDayOfWeek = selectedDate.getDay();
      const expectedIsPreferred = expectedDayOfWeek >= 1 && expectedDayOfWeek <= 5;

      // Si la quote ya refleja esta fecha, no recalcular
      if (
        quote.dayOfWeek === expectedDayOfWeek &&
        quote.isPreferredDay === expectedIsPreferred
      ) {
        return;
      }

      try {
        const res = await fetch("/api/quote/recalculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId: quote.id, serviceDate }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json();
          console.error("Quote recalculate error:", err.error);
          // v8.3 fix (auditoría 2026-07-15): antes esto era completamente
          // silencioso -- si el recálculo por fecha (recargo de fin de
          // semana, etc.) fallaba, el precio mostrado en pantalla se
          // quedaba desactualizado sin ningún aviso, aunque el backend de
          // /api/stripe/confirm sí recalcula correctamente al cobrar
          // (discrepancia silenciosa entre lo mostrado y lo cobrado).
          setRecalculateError(t("recalculateWarning"));
          return;
        }

        setRecalculateError("");
        const { quote: updatedQuote } = await res.json();
        setQuote(mapQuoteFromSupabase(updatedQuote));
      } catch (e) {
        // Fix (auditoría frontend 2026-08-01, item 6): un cambio rápido de
        // fecha antes de que responda el recálculo anterior lo cancela --
        // AbortError es la cancelación esperada, no se loguea como fallo.
        if (e instanceof DOMException && e.name === "AbortError") return;
        console.error("Failed to recalculate quote:", e);
      }
    }

    recalculateQuote();
    return () => controller.abort();
  }, [serviceDate, quote, t]);

  // v8.3 fix (auditoría E1 2026-07-18): el freeze de precio (10 min, fijo)
  // no se renovaba con la actividad del cliente -- alguien llenando datos de
  // tarjeta / pasando por 3-D Secure podía perder su precio a mitad del
  // flujo. Mientras la quote siga "pending" y sin confirmar, se hace un
  // heartbeat periódico a /api/quote/freeze-ping que extiende
  // price_frozen_until otros 10 min desde el momento del ping (con techo
  // absoluto de 60 min desde la aceptación original, ver esa ruta). Esto es
  // "latencia de red" -- el cliente sigue viendo el mismo aviso sutil de
  // PriceFreezeCountdown, no un cronómetro que se reinicia visualmente cada
  // vez (el countdown en sí solo se pone en evidencia en el último minuto).
  useEffect(() => {
    if (!quote?.id || quote.status !== "pending" || isConfirming) return;

    const PING_INTERVAL_MS = 2 * 60 * 1000; // cada 2 min, bien dentro de la ventana de 10 min

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/quote/freeze-ping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quoteId: quote.id }),
        });
        if (!res.ok) return; // no bloquear la UI por un ping fallido -- el countdown visible ya avisa
        const { priceFrozenUntil } = await res.json();
        if (priceFrozenUntil) {
          setQuote((prev) => (prev ? { ...prev, priceFrozenUntil } : prev));
        }
      } catch {
        // silencioso -- next tick reintenta
      }
    }, PING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [quote?.id, quote?.status, isConfirming]);

  // Create SetupIntent when date/time selected and user authenticated
  useEffect(() => {
    async function createSetupIntent() {
      if (!serviceDate || !serviceTime || !quote) return;

      setSetupIntentError("");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // Fix 2026-07-24: antes esto era un `return` silencioso -- el
        // cliente se quedaba viendo "Preparing secure checkout..." para
        // siempre sin saber que necesitaba loguearse. Ahora se explica el
        // motivo y se abre el AuthModal sin recargar la página ni perder la
        // fecha/hora ya elegidas.
        setSetupIntentError(t("payment.signInRequired"));
        setNeedsAuthForCheckout(true);
        return;
      }
      setNeedsAuthForCheckout(false);

      try {
        const res = await fetch("/api/stripe/setup-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: quote.id,
            userId: user.id,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error("SetupIntent error:", err.error);
          setSetupIntentError(
            err.error || t("payment.setupIntentFailed")
          );
          return;
        }

        const { clientSecret, customerId, setupIntentId } = await res.json();
        setStripeClientSecret(clientSecret);
        setStripeCustomerId(customerId);
        setStripeSetupIntentId(setupIntentId);
      } catch (e) {
        console.error("Failed to create SetupIntent:", e);
        setSetupIntentError(t("payment.setupIntentNetworkError"));
      }
    }

    createSetupIntent();
  }, [serviceDate, serviceTime, quote, setupIntentRetryKey, t]);

  const handlePaymentMethodReady = (pmId: string) => {
    setPaymentMethodId(pmId);
  };

  const handleSavedCardSelect = async (methodId: string) => {
    try {
      const res = await fetch(`/api/client/payment-methods/${encodeURIComponent(methodId)}/token`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      if (data.providerToken) {
        setPaymentMethodId(data.providerToken);
        setUsingNewCard(false);
      }
    } catch {
      // fallback: the confirmation endpoint will resolve the token
      setPaymentMethodId(methodId);
      setUsingNewCard(false);
    }
  };

  const handleConfirm = async () => {
    if (!quote || !serviceDate || !serviceTime || !paymentMethodId) {
      setConfirmError(t("confirm.completeAllSteps"));
      return;
    }

    if (priceFreezeExpired) {
      setConfirmError(t("confirm.priceHoldExpired"));
      return;
    }

    if (recalculateError) {
      // v8.3 fix (auditoría 2026-07-15): no permitir confirmar sobre un
      // precio que puede estar desactualizado -- el backend recalcula
      // correctamente de todos modos, pero es mejor bloquear con un mensaje
      // claro que dejar que el cliente confirme sin saber que el número en
      // pantalla podría no ser el final.
      setConfirmError(t("confirm.priceNotConfirmed"));
      return;
    }

    if (paymentOption === "paypal_first_time") {
      if (!paypalTransactionId.trim()) {
        setConfirmError(t("confirm.enterPaypalTransactionId"));
        return;
      }
      if (!PAYPAL_TRANSACTION_ID_RE.test(paypalTransactionId)) {
        setConfirmError(t("confirm.invalidPaypalTransactionId"));
        return;
      }
      if (paypalPayerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalPayerEmail)) {
        setConfirmError(t("confirm.invalidPaypalPayerEmail"));
        return;
      }
    }

    if ((paymentOption === "alipay" || paymentOption === "wechat_pay") && !walletPaymentIntentId) {
      setConfirmError(
        t("confirm.completePaymentFirst", {
          method: paymentOption === "alipay" ? t("payment.alipay") : t("payment.wechatPay"),
        })
      );
      return;
    }

    setIsConfirming(true);
    setConfirmError("");

    try {
      const res = await fetch("/api/stripe/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteId: quote.id,
          serviceDate,
          serviceTime,
          paymentMethodId,
          paymentOption,
          paypalTransactionId: paymentOption === "paypal_first_time" ? paypalTransactionId : undefined,
          paypalPayerEmail: paymentOption === "paypal_first_time" ? paypalPayerEmail : undefined,
          walletPaymentIntentId:
            paymentOption === "alipay" || paymentOption === "wechat_pay" ? walletPaymentIntentId : undefined,
          stripeCustomerId,
          stripeSetupIntentId,
          holdAmount: quote.holdAmount,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || t("confirm.genericError"));
      }

      const { orderId } = await res.json();
      const pathLocale = window.location.pathname.split("/")[1];
      const locale = ["en", "zh", "fr"].includes(pathLocale) ? pathLocale : "en";
      router.push(`/${locale}/confirmation?orderId=${orderId}`);
    } catch (err: Error | unknown) {
      setConfirmError(
        err instanceof Error ? err.message : t("confirm.genericError")
      );
    } finally {
      setIsConfirming(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center px-4">
        <div className="bg-white rounded-lg shadow-elevation-1 p-8 max-w-md w-full text-center">
          <div className="text-state-danger mb-4 font-medium">{error}</div>
          <button
            onClick={() => router.push(`/${safeLocale}/quote`)}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            {t("loadError.newQuoteButton")}
          </button>
        </div>
      </main>
    );
  }

  if (!quote) return null;

  // Fix (auditoría UX 2026-07-25, item 12): el paso "Card" se marcaba como
  // completado (done: true) apenas el cliente hacía click en la pestaña
  // "PayPal" -- eso solo hace setPaymentMethodId("paypal") (línea ~591), sin
  // que el cliente haya escrito todavía el Transaction ID ni pasado la
  // validación de formato que handleConfirm sí exige antes de dejar
  // confirmar (línea ~402). El indicador de progreso mentía. Para PayPal, el
  // paso solo se considera completo cuando paypalTransactionId ya tiene el
  // formato correcto (12-20 alfanuméricos, igual que el backend) -- la misma
  // validación que handleConfirm.
  const paypalStepDone =
    paymentOption === "paypal_first_time" && PAYPAL_TRANSACTION_ID_RE.test(paypalTransactionId);
  const stepLabels = [
    { icon: Calendar, label: t("steps.dateTime"), done: !!serviceDate && !!serviceTime },
    {
      icon: CreditCard,
      label: t("steps.card"),
      done: paymentOption === "paypal_first_time" ? paypalStepDone : !!paymentMethodId,
    },
    { icon: CheckCircle2, label: t("steps.confirm"), done: false },
  ];

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-gold" />
            <span className="font-semibold">{t("header.brand")}</span>
          </div>
          <span className="text-sm text-gray-300">{t("header.completeReservation")}</span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Step indicators */}
        <div className="flex items-center gap-4 mb-8">
          {stepLabels.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  s.done
                    ? "bg-state-success text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                <s.icon className="w-4 h-4" />
              </div>
              <span className="text-sm text-gray-600 hidden sm:inline">{s.label}</span>
              {i < stepLabels.length - 1 && (
                <div className="w-8 h-px bg-gray-300 mx-1" />
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Form */}
          <div className="space-y-6">
            {/* Date & Time */}
            <div className="bg-white rounded-lg shadow-elevation-1 p-6">
              <h2 className="text-lg font-semibold text-brand-ink mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-brand-gold" />
                {t("dateTime.title")}
              </h2>
              <div className="space-y-4">
                <DatePicker value={serviceDate} onChange={setServiceDate} />
                {serviceDate && (
                  <TimeSlotPicker
                    value={serviceTime}
                    onChange={setServiceTime}
                    serviceDate={serviceDate}
                    zone={quote.zone}
                    serviceType={quote.serviceType}
                    squareFeet={quote.squareFeet}
                  />
                )}
              </div>
            </div>

            {/* Payment Method */}
            {serviceDate && serviceTime && stripeClientSecret && (
              <div className="bg-white rounded-lg shadow-elevation-1 p-6 space-y-4">
                <h2 className="text-lg font-semibold text-brand-ink mb-4 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-brand-gold" />
                  {t("payment.title")}
                </h2>

                {/* Feature 2026-07-21: Alipay/WeChat Pay se agregaron al
                    mismo selector -- disponibles para cualquier cliente
                    (decisión de negocio), cobran el 100% por adelantado (ver
                    WalletPayButton.tsx), a diferencia de Card/PayPal. El
                    toggle ahora siempre se muestra (antes solo aparecía si
                    paypalEnabled && isFirstTimeClient) para que el cliente
                    siempre pueda volver a "Card" sin quedar atascado en
                    Alipay/WeChat Pay. */}
                <div className="flex flex-wrap gap-2 p-1 bg-gray-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentOption("card");
                      setPaymentMethodId("");
                      setWalletPaymentIntentId("");
                    }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      paymentOption === "card"
                        ? "bg-white text-brand-navy shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t("payment.card")}
                  </button>
                  {paypalEnabled && isFirstTimeClient && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentOption("paypal_first_time");
                        setPaymentMethodId("paypal");
                        setWalletPaymentIntentId("");
                      }}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                        paymentOption === "paypal_first_time"
                          ? "bg-white text-brand-navy shadow-sm"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                    >
                      {t("payment.paypalFirstTime")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentOption("alipay");
                      setPaymentMethodId("");
                      setWalletPaymentIntentId("");
                    }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      paymentOption === "alipay"
                        ? "bg-white text-brand-navy shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t("payment.alipay")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentOption("wechat_pay");
                      setPaymentMethodId("");
                      setWalletPaymentIntentId("");
                    }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                      paymentOption === "wechat_pay"
                        ? "bg-white text-brand-navy shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    {t("payment.wechatPay")}
                  </button>
                </div>

                {paymentOption === "card" && (
                  <>
                    <SavedCardSelector
                      onSelectSavedCard={handleSavedCardSelect}
                      onUseNewCard={() => setUsingNewCard(true)}
                      usingNewCard={usingNewCard}
                      disabled={isConfirming}
                    />
                    {usingNewCard && (
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: stripeClientSecret,
                      appearance: { theme: "stripe" as const },
                    }}
                  >
                    <ApplePayButton
                      onPaymentMethodReady={handlePaymentMethodReady}
                      disabled={isConfirming}
                      clientSecret={stripeClientSecret}
                      amountCents={Math.round((quote.total || 0) * 100)}
                    />
                    <StripeCardForm
                      onPaymentMethodReady={handlePaymentMethodReady}
                      disabled={isConfirming}
                      clientSecret={stripeClientSecret}
                    />
                  </Elements>
                    )}
                  </>
                )}

                {paymentOption === "paypal_first_time" && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      {t("payment.paypalDesc")}
                    </p>
                    {/* Fix (2026-07-25, auditoría UX/seguridad): la entrada manual de
                        Transaction ID/email es alto riesgo de fricción y fraude (nada
                        impide que el cliente escriba un ID inventado o de otra
                        transacción -- /api/stripe/confirm hoy solo guarda estos campos,
                        no los valida contra la API de PayPal). Reescribir el flujo para
                        verificar contra PayPal en tiempo real requeriría integración de
                        backend fuera de alcance de este pase; en su lugar se agrega:
                        formato/longitud esperados (12-20 caracteres alfanuméricos, igual
                        que valida src/app/api/stripe/confirm/route.ts en el backend --
                        fuente de verdad, ver fix punto 3 de la revisión 2026-07-30),
                        advertencia explícita de escribir el ID EXACTO como aparece en el
                        email de confirmación de PayPal, validación inline con mensajes de
                        error claros antes de habilitar "Confirm", y normalización a
                        mayúsculas (el ID de PayPal siempre es mayúsculas). */}
                    <div className="bg-state-warning/10 border border-state-warning/30 rounded-lg p-3 text-xs text-state-warning">
                      {t("payment.paypalManualEntryWarning")}
                    </div>
                    <div>
                      <input
                        aria-label={t("payment.paypalTransactionIdAriaLabel")}
                        type="text"
                        value={paypalTransactionId}
                        onChange={(e) =>
                          setPaypalTransactionId(
                            e.target.value.toUpperCase().replace(/\s/g, "").slice(0, PAYPAL_TRANSACTION_ID_MAX_LENGTH)
                          )
                        }
                        placeholder={t("payment.paypalTransactionIdPlaceholder")}
                        maxLength={PAYPAL_TRANSACTION_ID_MAX_LENGTH}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold font-mono tracking-wide ${
                          paypalTransactionId && !PAYPAL_TRANSACTION_ID_RE.test(paypalTransactionId)
                            ? "border-state-danger"
                            : ""
                        }`}
                      />
                      <p
                        className={`text-xs mt-1 ${
                          paypalTransactionId && !PAYPAL_TRANSACTION_ID_RE.test(paypalTransactionId)
                            ? "text-state-danger"
                            : "text-gray-400"
                        }`}
                      >
                        {paypalTransactionId && !PAYPAL_TRANSACTION_ID_RE.test(paypalTransactionId)
                          ? t("payment.paypalTransactionIdInvalidLength", { count: paypalTransactionId.length })
                          : t("payment.paypalTransactionIdHint")}
                      </p>
                    </div>
                    <div>
                      <input
                        aria-label={t("payment.paypalPayerEmailAriaLabel")}
                        type="email"
                        autoComplete="email"
                        value={paypalPayerEmail}
                        onChange={(e) => setPaypalPayerEmail(e.target.value)}
                        placeholder={t("payment.paypalPayerEmailPlaceholder")}
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold ${
                          paypalPayerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalPayerEmail)
                            ? "border-state-danger"
                            : ""
                        }`}
                      />
                      {paypalPayerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalPayerEmail) && (
                        <p className="text-xs mt-1 text-state-danger">{t("payment.paypalPayerEmailInvalid")}</p>
                      )}
                    </div>
                  </div>
                )}

                {(paymentOption === "alipay" || paymentOption === "wechat_pay") && (
                  <Elements
                    stripe={stripePromise}
                    options={{
                      clientSecret: stripeClientSecret,
                      appearance: { theme: "stripe" as const },
                    }}
                  >
                    <div className="space-y-4">
                      <p className="text-sm text-gray-600">
                        {paymentOption === "alipay"
                          ? t("payment.walletPayNowAlipay")
                          : t("payment.walletPayNowWechat")}
                        {" "}
                        {t("payment.walletBackupCardNote", {
                          method: paymentOption === "alipay" ? t("payment.alipay") : t("payment.wechatPay"),
                        })}
                      </p>
                      {/* Fix (auditoría 2026-07-30): redirect_status "processing"/
                          "requires_action" de vuelta de Alipay -- el pago no está
                          confirmado, no se debe tratar como éxito, pero tampoco
                          silenciarlo. Se ofrece reintentar (crea un PaymentIntent
                          nuevo desde cero vía WalletPayButton). */}
                      {walletRedirectStatus && !walletPaymentIntentId && (
                        <div className="flex items-center justify-between gap-3 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                            {t("payment.walletConfirmingWithProvider")}
                          </span>
                          <button
                            type="button"
                            onClick={() => setWalletRedirectStatus("")}
                            className="underline whitespace-nowrap"
                          >
                            {t("payment.tryAgain")}
                          </button>
                        </div>
                      )}
                      <WalletPayButton
                        walletType={paymentOption}
                        // Fix (2026-07-24): quote.id es opcional en el tipo QuoteData
                        // (se usa también para cotizaciones nuevas sin guardar), pero en
                        // esta página siempre se cargó una cotización existente por su id
                        // de la URL -- se usa ese `quoteId` (string, no opcional) en vez
                        // de quote.id para que tsc no lo marque como posiblemente undefined.
                        quoteId={quoteId}
                        disabled={isConfirming}
                        confirmedPaymentIntentId={walletPaymentIntentId}
                        onPaymentConfirmed={setWalletPaymentIntentId}
                      />
                      {walletPaymentIntentId && (
                        <div className="pt-4 border-t border-gray-200 space-y-2">
                          <p className="text-sm font-medium text-brand-ink">{t("payment.backupCardLabel")}</p>
                          <StripeCardForm
                            onPaymentMethodReady={handlePaymentMethodReady}
                            disabled={isConfirming}
                            clientSecret={stripeClientSecret}
                          />
                        </div>
                      )}
                    </div>
                  </Elements>
                )}
              </div>
            )}

            {quote?.priceFrozenUntil && (
              <PriceFreezeCountdown
                frozenUntilIso={quote.priceFrozenUntil}
                onExpired={() => setPriceFreezeExpired(true)}
              />
            )}

            {recalculateError && (
              <div className="bg-state-warning/10 border border-state-warning text-state-warning text-sm rounded-lg p-3">
                {recalculateError}
              </div>
            )}

            {serviceDate && serviceTime && !stripeClientSecret && paymentOption === "card" && !setupIntentError && (
              <div className="bg-white rounded-lg shadow-elevation-1 p-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-brand-gold mx-auto mb-2" />
                <p className="text-sm text-gray-500">{t("payment.preparingCheckout")}</p>
              </div>
            )}

            {serviceDate && serviceTime && !stripeClientSecret && paymentOption === "card" && setupIntentError && (
              <div className="bg-white rounded-lg shadow-elevation-1 p-6 text-center space-y-3">
                <p className="text-sm text-state-danger">{setupIntentError}</p>
                <button
                  type="button"
                  onClick={() => setSetupIntentRetryKey((k) => k + 1)}
                  className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-semibold"
                >
                  {t("payment.tryAgain")}
                </button>
              </div>
            )}
          </div>

          {/* Right: Summary */}
          <div className="space-y-6">
            <ReservationSummary
              quote={quote}
              serviceDate={serviceDate}
              serviceTime={serviceTime}
            />

            <CheckoutBenefitsPanel />

            {/* Confirm button
                Fix (2026-07-25, auditoría UX): en móvil, este botón (el CTA
                principal del flujo) se desplazaba fuera de pantalla al final
                de una columna larga -- el cliente tenía que hacer scroll de
                vuelta para confirmar. sticky bottom-0 lo mantiene visible
                mientras se hace scroll por debajo del breakpoint lg; en
                desktop (lg+) vuelve a su posición estática normal dentro de
                la columna, donde ya hay suficiente espacio visible. */}
            {paymentMethodId && (
              <div className="sticky bottom-0 z-40 -mx-4 px-4 pb-[env(safe-area-inset-bottom)] lg:static lg:z-auto lg:mx-0 lg:px-0 lg:pb-0">
                <div className="bg-white rounded-lg shadow-[0_-6px_16px_rgba(15,23,42,0.12)] lg:shadow-elevation-1 p-6">
                  {confirmError && (
                    <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm mb-4">
                      {confirmError}
                    </div>
                  )}
                  <button
                    aria-label={t("confirm.confirmAriaLabel")}
                    onClick={handleConfirm}
                    disabled={isConfirming || needsPhoneVerification}
                    className="w-full inline-flex items-center justify-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isConfirming ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {t("confirm.confirming")}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        {t("confirm.button")}
                      </>
                    )}
                  </button>
                  {needsPhoneVerification && (
                    <p className="text-xs text-state-danger mt-2 text-center">
                      {t("confirm.phoneVerificationRequired")}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-3 text-center">
                    {t("confirm.termsNote")}{" "}
                    <a
                      href={`/${safeLocale}/cancellation`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-brand-navy"
                    >
                      {t("confirm.viewCancellationPolicy")}
                    </a>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* v8.3 fix (auditoría E1 2026-07-18): verificación telefónica
          obligatoria -- bloquea la reserva hasta que client_profiles.phone_verified
          sea true. El servidor (/api/stripe/confirm) también lo exige. */}
      {needsPhoneVerification && (
        <AuthModal
          onClose={() => {
            /* no-op: sin "X" en forcePhoneVerification, no se puede cerrar */
          }}
          onSuccess={() => setNeedsPhoneVerification(false)}
          forcePhoneVerification
        />
      )}

      {/* Fix 2026-07-24: mismo AuthModal reutilizado -- se abre cuando el
          useEffect de creación del SetupIntent detecta que no hay sesión.
          Se puede cerrar (a diferencia de forcePhoneVerification) porque el
          cliente puede seguir viendo el resto de la página / elegir otra
          fecha; simplemente no verá el formulario de tarjeta hasta loguearse.
          onSuccess incrementa setupIntentRetryKey para reintentar la
          creación del SetupIntent sin recargar la página. */}
      {needsAuthForCheckout && !needsPhoneVerification && (
        <AuthModal
          onClose={() => setNeedsAuthForCheckout(false)}
          onSuccess={() => {
            setNeedsAuthForCheckout(false);
            setSetupIntentError("");
            setSetupIntentRetryKey((k) => k + 1);
          }}
        />
      )}
    </main>
  );
}

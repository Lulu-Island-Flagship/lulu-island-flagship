"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { QuoteInput, QuoteData, CotizadorStep } from "@/types";
import { ServiceType, TARIFA_OBJETIVO_HORA } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
import { StepCategory } from "@/components/cotizador/StepCategory";
import { StepPurpose } from "@/components/cotizador/StepPurpose";
import { StepDimensions } from "@/components/cotizador/StepDimensions";
import { StepAddonZones } from "@/components/cotizador/StepAddonZones";
import { StepOrganic } from "@/components/cotizador/StepOrganic";
import { StepRecency } from "@/components/cotizador/StepRecency";
import { StepAddress } from "@/components/cotizador/StepAddress";
import { PriceBreakdown } from "@/components/cotizador/PriceBreakdown";
import { ConsentCheck } from "@/components/cotizador/ConsentCheck";
import { LanguagePreference } from "@/components/cotizador/LanguagePreference";
import { AcquisitionChannelSelect } from "@/components/cotizador/AcquisitionChannelSelect";
import type { AcquisitionChannel } from "@/lib/acquisition-channel";
import { AuthModal } from "@/components/cotizador/AuthModal";
import {
  ChevronLeft,
  ChevronRight,
  Shield,
  Clock,
  CheckCircle2,
  Loader2,
} from "lucide-react";

const STEPS: CotizadorStep[] = [
  "category",
  "purpose",
  "dimensions",
  "addonZones",
  "organic",
  "recency",
  "address",
  "summary",
];

const LOCAL_STORAGE_KEY = "lulu_cotizador_state";
const PENDING_AUTH_KEY = "lulu_pending_auth_quote";

function loadStateFromStorage(): { stepIndex: number; input: Partial<QuoteInput> } | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validar que no sea más viejo de 1 hora
    if (parsed.timestamp && Date.now() - parsed.timestamp > 60 * 60 * 1000) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      return null;
    }
    return { stepIndex: parsed.stepIndex ?? 0, input: parsed.input ?? {} };
  } catch {
    return null;
  }
}

function saveStateToStorage(stepIndex: number, input: Partial<QuoteInput>) {
  try {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({ stepIndex, input, timestamp: Date.now() })
    );
  } catch {
    // ignore
  }
}

function clearStateFromStorage() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    localStorage.removeItem(PENDING_AUTH_KEY);
  } catch {
    // ignore
  }
}

function markPendingAuth() {
  try {
    localStorage.setItem(PENDING_AUTH_KEY, "true");
  } catch {
    // ignore
  }
}

function wasPendingAuth(): boolean {
  try {
    const val = localStorage.getItem(PENDING_AUTH_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

function clearPendingAuth() {
  try {
    localStorage.removeItem(PENDING_AUTH_KEY);
  } catch {
    // ignore
  }
}

export default function CotizadorPage() {
  const router = useRouter();
  const t = useTranslations("cotizador");

  // Estado inicial vacío — localStorage se lee SOLO en useEffect (cliente)
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState<Partial<QuoteInput>>({});
  const [isHydrated, setIsHydrated] = useState(false);

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [priceFrozenUntil, setPriceFrozenUntil] = useState<Date | null>(null);
  const [consents, setConsents] = useState({
    tc: false,
    pipa: false,
    marketing: false,
    photoMarketing: false,
  });
  const [purchaseOrder, setPurchaseOrder] = useState("");
  const [preferredLanguages, setPreferredLanguages] = useState<string[]>(["en"]);
  const [acquisitionChannel, setAcquisitionChannel] = useState<AcquisitionChannel | "">("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // v8.3 fix (auditoría 2026-07-15): antes un fallo de OAuth (Google/Apple)
  // era completamente silencioso -- /auth/callback ya agrega ?auth_error=
  // a la URL de redirect, pero ningún componente lo leía. El usuario volvía
  // sin sesión y sin ningún mensaje, indistinguible de un botón roto.
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  // v8.3 fix (auditoría E1 2026-07-18): un cliente que entra por Google/Apple
  // nunca pasaba por verificación telefónica -- se agrega un paso obligatorio
  // (AuthModal en modo forcePhoneVerification) antes de dejarlo avanzar a
  // reservar, si client_profiles.phone_verified no es true.
  const [needsPhoneVerification, setNeedsPhoneVerification] = useState(false);
  const [pendingSubmitUserId, setPendingSubmitUserId] = useState<string | null>(null);

  // B2B review se deriva de la cotización server-side o, en ausencia de ella, de la categoría comercial
  const b2bReviewRequired =
    (quote && (quote.accountType === "b2b" || quote.accountType === "government")) ||
    input.serviceCategory === "commercial";

  // Restaurar estado desde localStorage SOLO si venimos de un login pendiente
  // (pending_auth_quote). Si no, empezamos desde cero (cotización nueva).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      const messages: Record<string, string> = {
        provider_error: t("authErrors.providerError"),
        session_exchange_failed: t("authErrors.sessionExchangeFailed"),
        missing_code: t("authErrors.missingCode"),
      };
      setAuthErrorMessage(messages[authError] || t("authErrors.default"));
      setShowAuthModal(true);
      // Limpiar el query param para que un refresh no vuelva a mostrar el
      // error ni lo deje visible/compartible en la URL.
      params.delete("auth_error");
      const newSearch = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (newSearch ? `?${newSearch}` : ""));
    }
  }, []);

  useEffect(() => {
    const pendingAuth = wasPendingAuth();
    // v8.3 fix (auditoría 2026-07-15): antes SOLO se restauraba el estado
    // guardado si venía de un login pendiente -- un refresh accidental
    // (F5), cerrar y reabrir la pestaña, o navegar "atrás" y luego
    // "adelante" hacia /cotizador directamente descartaba TODO el
    // progreso ya ingresado (dirección, m², mascotas, etc.) sin ningún
    // aviso, aunque el localStorage con el estado real seguía presente y
    // válido (TTL de 1h). QuoteButton.tsx ya limpia el storage cuando el
    // usuario inicia una cotización nueva a propósito desde la landing, así
    // que si hay un estado guardado no vencido aquí, es señal real de un
    // flujo interrumpido -- se restaura siempre, no solo tras login.
    const saved = loadStateFromStorage();
    if (pendingAuth || saved) {
      if (saved) {
        setStepIndex(saved.stepIndex);
        setInput(saved.input);
      }
      if (pendingAuth) clearPendingAuth();
    } else {
      // Inicializar valores default para que el usuario pueda avanzar sin tocar
      // cada control, pero sigue pudiendo modificarlos.
      setInput((prev) => ({
        ...prev,
        bedrooms: prev.bedrooms ?? 2,
        bathrooms: prev.bathrooms ?? 1,
        squareFeet: prev.squareFeet ?? 1000,
        petsCount: prev.petsCount ?? 0,
        petsType: prev.petsType ?? "none",
        residents: prev.residents ?? 2,
        daysSinceCleaning: prev.daysSinceCleaning ?? 30,
      }));
    }
    // Si no hay pending_auth, empezamos desde cero (stepIndex=0, input={})
    setIsHydrated(true);
  }, []);

  const step = STEPS[stepIndex];

  // Persistir estado en localStorage — SOLO después de hidratación para no
  // sobreescribir el estado guardado durante el montaje inicial post-OAuth
  useEffect(() => {
    if (!isHydrated) return;
    saveStateToStorage(stepIndex, input);
  }, [stepIndex, input, isHydrated]);

  const updateInput = useCallback(
    (updates: Partial<QuoteInput>) => {
      setInput((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const fetchPreviewQuote = useCallback(async () => {
    if (
      !input.serviceType ||
      !input.squareFeet ||
      input.petsCount === undefined ||
      input.petsType === undefined ||
      !input.residents ||
      input.daysSinceCleaning === undefined ||
      !input.zone
    ) {
      setQuote(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await fetch("/api/quote/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || t("errors.genericPreview"));
      }

      const data = await response.json();
      const q = data.quote as QuoteData;
      setQuote(q);
      setPriceFrozenUntil(new Date(q.priceFrozenUntil));
    } catch (err: Error | unknown) {
      const message = err instanceof Error ? err.message : t("errors.genericPreview");
      setPreviewError(message);
      setQuote(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [input]);

  useEffect(() => {
    if (step === "summary") {
      fetchPreviewQuote();
    }
  }, [step, fetchPreviewQuote]);

  const canProceed = () => {
    switch (step) {
      case "category":
        return !!input.serviceCategory;
      case "purpose":
        return !!input.serviceSubtype;
      case "dimensions":
        return (
          input.bedrooms !== undefined &&
          input.bathrooms !== undefined &&
          input.squareFeet !== undefined
        );
      case "addonZones":
        return true; // paso opcional, nunca bloquea el avance
      case "organic":
        return (
          input.petsCount !== undefined &&
          input.residents !== undefined
        );
      case "recency":
        return input.daysSinceCleaning !== undefined;
      case "address":
        return (
          !!input.address &&
          !!input.zone &&
          !!input.postalCode &&
          /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\s?\d[ABCEGHJ-NPRSTVWXYZ]\d$/i.test(input.postalCode)
        );
      case "summary":
        return consents.tc && !!acquisitionChannel && (!b2bReviewRequired || purchaseOrder.trim().length > 0);
      default:
        return false;
    }
  };

  // Fix (2026-07-24): dirección de la última navegación real (no la que
  // dispara el auto-skip de "addonZones" más abajo), para que el salto del
  // paso vacío avance o retroceda según el sentido en que el cliente venía
  // moviéndose, en vez de forzar siempre "adelante".
  const navDirectionRef = useRef<"forward" | "backward">("forward");

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      navDirectionRef.current = "forward";
      setStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (stepIndex === 0) {
      // En el primer paso, volver a la landing page con locale preservado
      const pathLocale = window.location.pathname.split("/")[1];
      const locale = ["en", "zh", "fr"].includes(pathLocale) ? pathLocale : "en";
      router.push(`/${locale}`);
      return;
    }
    navDirectionRef.current = "backward";
    setStepIndex((prev) => prev - 1);
  };

  // Fix (2026-07-24): StepAddonZones documentaba "si no hay zonas add-on,
  // el paso no renderiza nada (el wizard lo salta)" pero ese salto nunca
  // estaba implementado -- ver comentario en StepAddonZones.tsx. Esto lo
  // implementa: cuando el componente confirma que no hay zonas para el
  // service_subtype elegido, se avanza/retrocede un paso más en la misma
  // dirección en la que el cliente venía navegando.
  const handleEmptyAddonZones = useCallback(() => {
    setStepIndex((prev) =>
      navDirectionRef.current === "forward"
        ? Math.min(prev + 1, STEPS.length - 1)
        : Math.max(prev - 1, 0)
    );
  }, []);

  // Fix (2026-07-25, auditoría UX): /api/quote devuelve `profileWarning`
  // (el perfil de cliente no se pudo crear/actualizar del todo -- ver
  // api/quote/route.ts) y `adminReviewRequired`, pero antes solo se hacía
  // console.warn del segundo y el primero se ignoraba por completo -- el
  // cliente nunca se enteraba de que algo necesitaba re-confirmarse o
  // revisarse. En vez de redirigir de inmediato a /reserva/[quoteId] (donde
  // adminReviewRequired ya bloquea la reserva con un error genérico, ver esa
  // página), ahora se pausa aquí con un aviso no bloqueante y explícito
  // antes de continuar, para que el mensaje realmente llegue al cliente.
  const [postSubmitNotice, setPostSubmitNotice] = useState<{
    quoteId: string;
    profileWarning?: boolean;
    adminReviewRequired?: boolean;
  } | null>(null);

  const goToReservation = (quoteId: string) => {
    clearStateFromStorage();
    const pathLocale = window.location.pathname.split("/")[1];
    const locale = ["en", "zh", "fr"].includes(pathLocale) ? pathLocale : "en";
    router.push(`/${locale}/reserva/${quoteId}`);
  };

  const handleSubmit = async (forcedUserId?: string) => {
    if (!quote) return;
    if (!consents.tc) {
      setSubmitError(t("errors.acceptTerms"));
      return;
    }
    if (!acquisitionChannel) {
      setSubmitError(t("errors.acquisitionRequired"));
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      // Always verify session fresh from Supabase before trusting it.
      // Fix (auditoría de autenticación 2026-07-25/26, item 3): getSession()
      // solo lee el JWT local sin validarlo contra el servidor -- getUser()
      // sí lo valida, que es lo que este comentario ya decía que se quería
      // hacer.
      let currentUserId = forcedUserId;
      if (!currentUserId) {
        const { data: { user } } = await supabase.auth.getUser();
        currentUserId = user?.id;
      }

      if (!currentUserId) {
        markPendingAuth();
        setShowAuthModal(true);
        setIsSubmitting(false);
        return;
      }

      // Enviar SOLO inputs brutos + consents. El servidor recalcula todo.
      const rawInputs = {
        serviceCategory: input.serviceCategory,
        serviceSubtype: input.serviceSubtype,
        serviceType: input.serviceType,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        squareFeet: input.squareFeet,
        petsCount: input.petsCount,
        petsType: input.petsType,
        residents: input.residents,
        daysSinceCleaning: input.daysSinceCleaning,
        address: input.address,
        zone: input.zone,
        postalCode: input.postalCode,
        dayOfWeek: input.dayOfWeek,
        isPreferredDay: input.isPreferredDay,
        addonZones: input.addonZones,
        consentTc: consents.tc,
        consentPipa: consents.pipa,
        consentMarketing: consents.marketing,
        consentPhotoMarketing: consents.photoMarketing,
        purchaseOrder: purchaseOrder.trim() || undefined,
        preferredLanguages,
        acquisitionChannel,
      };

      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawInputs),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || t("errors.genericSubmit"));
      }

      const {
        quoteId,
        adminReviewRequired,
        b2bReviewRequired,
        profileWarning,
      } = await response.json();

      if (b2bReviewRequired) {
        setSubmitError(t("errors.commercialReview"));
        clearStateFromStorage();
        setIsSubmitting(false);
        return;
      }

      if (profileWarning || adminReviewRequired) {
        // Fix (2026-07-25): antes profileWarning se ignoraba del todo y
        // adminReviewRequired solo se logueaba -- el cliente pasaba directo
        // a /reserva sin enterarse. Se pausa aquí con un aviso visible y no
        // bloqueante (el cliente decide cuándo continuar) en vez de
        // redirigir en silencio.
        setPostSubmitNotice({ quoteId, profileWarning, adminReviewRequired });
        setIsSubmitting(false);
        return;
      }

      goToReservation(quoteId);
    } catch (err: Error | unknown) {
      setSubmitError(err instanceof Error ? err.message : t("errors.genericSubmit"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAuthSuccess = async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (!data.user) {
        setShowAuthModal(false);
        return;
      }

      // v8.3 fix (auditoría E1): verificación telefónica obligatoria antes
      // de avanzar a reservar, sin importar el método de login usado.
      const { data: profile } = await supabase
        .from("client_profiles")
        .select("phone_verified")
        .eq("user_id", data.user.id)
        .maybeSingle();

      // v8.3 P0-2 (auditoría Fable5): condicional a que exista proveedor de
      // SMS real -- sin proveedor, Supabase Auth OTP nunca entrega el
      // código y este modal (sin botón de cerrar) dejaría al cliente
      // atorado para siempre. Mismo chequeo que /api/stripe/confirm
      // (isSmsProviderConfigured(), expuesto vía /api/system/sms-status).
      let smsConfigured = true;
      try {
        const statusRes = await fetch("/api/system/sms-status");
        const statusData = await statusRes.json();
        smsConfigured = Boolean(statusData?.configured);
      } catch {
        // Falla cerrado hacia el comportamiento MÁS estricto (exigir
        // verificación), nunca hacia dejar pasar sin verificar por un
        // error de red al consultar el estado.
        smsConfigured = true;
      }

      if (smsConfigured && !profile?.phone_verified) {
        setPendingSubmitUserId(data.user.id);
        setNeedsPhoneVerification(true);
        // showAuthModal se mantiene true -- el modal cambia a modo
        // forcePhoneVerification (ver render de AuthModal más abajo).
        return;
      }

      setShowAuthModal(false);
      // Pass the user ID directly to avoid stale closure
      handleSubmit(data.user.id);
    } catch (err: Error | unknown) {
      setSubmitError(err instanceof Error ? err.message : t("errors.genericAuth"));
      setShowAuthModal(true);
    }
  };

  // Se llama cuando el paso de verificación telefónica obligatoria termina
  // con éxito (ver AuthModal forcePhoneVerification más abajo).
  const handlePhoneVerified = () => {
    setNeedsPhoneVerification(false);
    setShowAuthModal(false);
    if (pendingSubmitUserId) {
      handleSubmit(pendingSubmitUserId);
      setPendingSubmitUserId(null);
    }
  };

  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  // Prevent hydration mismatch: render empty/skeleton until client hydration completes
  if (!isHydrated) {
    return (
      <main className="min-h-screen bg-brand-ice flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-brand-gold/20 rounded-full" />
          <div className="h-4 w-32 bg-gray-200 rounded" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-gold" />
            <span className="font-semibold">{t("brand")}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Clock className="w-4 h-4" />
            {/* Fix (auditoría UX/seguridad 2026-07-30, BUG 1): antes este aviso
                se ocultaba justo en el paso "summary" (`step !== "summary"`),
                que es el único paso donde el cliente de verdad hace clic en
                "Reserve Now" -- si el freeze vencía mientras revisaba el
                resumen, el clic fallaba sin ningún aviso previo. Se muestra
                también en "summary" para que la cuenta regresiva del freeze
                siga visible hasta el final del flujo. */}
            {priceFrozenUntil && (
              <span>
                {t("priceLockedUntil", {
                  time: priceFrozenUntil.toLocaleTimeString("en-CA", {
                    timeZone: "America/Vancouver",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-brand-ink">
              {t("stepOf", { current: stepIndex + 1, total: STEPS.length })}
            </span>
            <span className="text-sm text-gray-500">
              {t(`stepLabels.${step}`)}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-brand-gold h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-elevation-1 p-6 md:p-8">
          {step === "category" && (
            <StepCategory
              value={input.serviceCategory}
              onChange={(val) => {
                updateInput({ serviceCategory: val, serviceSubtype: undefined, serviceType: undefined });
              }}
            />
          )}
          {step === "purpose" && (
            <StepPurpose
              category={input.serviceCategory}
              value={input.serviceSubtype}
              onChange={(subtype, serviceTypeVal) => {
                updateInput({ serviceSubtype: subtype, serviceType: serviceTypeVal as ServiceType });
              }}
            />
          )}
          {step === "dimensions" && (
            <StepDimensions
              bedrooms={input.bedrooms ?? 2}
              bathrooms={input.bathrooms ?? 1}
              squareFeet={input.squareFeet ?? 1000}
              onChange={(vals) => updateInput(vals)}
            />
          )}
          {step === "addonZones" && (
            <StepAddonZones
              serviceSubtype={input.serviceSubtype}
              targetHourlyRate={TARIFA_OBJETIVO_HORA}
              selected={input.addonZones ?? []}
              onChange={(zones) => updateInput({ addonZones: zones })}
              onEmpty={handleEmptyAddonZones}
            />
          )}
          {step === "organic" && (
            <StepOrganic
              petsCount={input.petsCount ?? 0}
              petsType={input.petsType ?? ""}
              residents={input.residents ?? 2}
              onChange={(vals) => updateInput(vals)}
            />
          )}
          {step === "recency" && (
            <StepRecency
              days={input.daysSinceCleaning ?? 30}
              onChange={(val) => updateInput({ daysSinceCleaning: val })}
            />
          )}
          {step === "address" && (
            <StepAddress
              address={input.address ?? ""}
              zone={input.zone ?? ""}
              postalCode={input.postalCode ?? ""}
              onChange={(vals) => updateInput(vals)}
              squareFeet={input.squareFeet}
              onSquareFeetConfirm={(squareFeet) => updateInput({ squareFeet })}
            />
          )}
          {step === "summary" && (
            <div className="space-y-6">
              {previewLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
                  <p className="text-sm text-gray-600">{t("summary.calculating")}</p>
                </div>
              )}

              {/* Fix (2026-07-25, auditoría UX): antes este error solo mostraba
                  el mensaje, sin ninguna forma de recuperarse salvo recargar
                  toda la página (perdiendo todo el estado del formulario,
                  guardado en localStorage solo por 1h y de todos modos una
                  mala experiencia). fetchPreviewQuote ya es una función
                  reutilizable (useCallback) -- basta con volver a invocarla
                  con los mismos `input` ya en memoria, sin perder nada. */}
              {!previewLoading && previewError && (
                <div className="p-4 bg-state-danger/10 text-state-danger rounded-lg text-sm text-center space-y-3">
                  <p>{previewError}</p>
                  <button
                    type="button"
                    onClick={() => fetchPreviewQuote()}
                    className="inline-flex items-center gap-2 bg-state-danger text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    {t("summary.retryCalculation")}
                  </button>
                </div>
              )}

              {!previewLoading && !previewError && quote && (
                <>
                  <div className="text-center">
                    <CheckCircle2 className="w-12 h-12 text-state-success mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-brand-ink mb-2">
                      {t("summary.ready")}
                    </h2>
                    <p className="text-gray-600">
                      {t("summary.readySubtitle")}
                    </p>
                  </div>

                  {b2bReviewRequired && (
                    <div className="p-4 bg-state-warning/10 border border-state-warning/20 rounded-lg">
                      <p className="text-sm font-medium text-state-warning">
                        {t("summary.b2bTitle")}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {t("summary.b2bDesc")}
                      </p>
                    </div>
                  )}

                  <PriceBreakdown quote={quote} />

                  {b2bReviewRequired && (
                    <div className="p-4 bg-brand-navy/5 border border-brand-navy/10 rounded-lg">
                      <label htmlFor="purchase-order-number" className="block text-sm font-medium text-brand-ink mb-1">
                        {t("summary.poLabel")}
                      </label>
                      <input
                        id="purchase-order-number"
                        type="text"
                        value={purchaseOrder}
                        onChange={(e) => setPurchaseOrder(e.target.value)}
                        placeholder="PO-2026-0001"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {t("summary.poHint")}
                      </p>
                    </div>
                  )}

                  <LanguagePreference
                    value={preferredLanguages}
                    onChange={setPreferredLanguages}
                  />

                  <AcquisitionChannelSelect
                    value={acquisitionChannel}
                    onChange={setAcquisitionChannel}
                  />

                  <ConsentCheck
                    consents={consents}
                    onChange={setConsents}
                  />

                  {/* Fix (revisión 2026-07-30, punto 4): consentPipa no bloqueaba el
                      avance (correcto -- no es obligatorio) pero tampoco se avisaba
                      al cliente de que declinarlo implica revisión manual adicional
                      antes de confirmar la reserva. */}
                  {consents.pipa === false && (
                    <div className="p-4 bg-state-warning/10 border border-state-warning/20 rounded-lg">
                      <p className="text-sm font-medium text-state-warning">
                        {t("summary.pipaReviewTitle")}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        {t("summary.pipaReviewDesc")}
                      </p>
                    </div>
                  )}
                </>
              )}

              {submitError && (
                <div className="p-4 bg-state-danger/10 text-state-danger rounded-lg text-sm">
                  {submitError}
                </div>
              )}

              {/* Fix (2026-07-25, auditoría UX): el estado postSubmitNotice ya
                  existía (ver handleSubmit) pero nunca se renderizaba -- el
                  cliente que disparaba profileWarning/adminReviewRequired se
                  quedaba viendo el botón "Reserve Now" volver a su estado
                  normal sin ninguna explicación de qué pasó ni cómo seguir.
                  Este banner explica la situación y da un botón explícito
                  para continuar a /reserva cuando el cliente esté listo. */}
              {postSubmitNotice && (
                <div className="p-4 bg-state-warning/10 border border-state-warning/20 rounded-lg space-y-2">
                  <p className="text-sm font-medium text-state-warning">
                    {postSubmitNotice.adminReviewRequired
                      ? t("summary.adminReviewTitle")
                      : t("summary.profileWarningTitle")}
                  </p>
                  <p className="text-xs text-gray-600">
                    {postSubmitNotice.adminReviewRequired
                      ? t("summary.adminReviewDesc")
                      : t("summary.profileWarningDesc")}
                  </p>
                  <button
                    type="button"
                    onClick={() => goToReservation(postSubmitNotice.quoteId)}
                    className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-navy-light transition-colors"
                  >
                    {t("summary.continueToReservation")}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            aria-label={stepIndex === 0 ? t("nav.homeAriaLabel") : t("nav.backAriaLabel")}
            onClick={handleBack}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-brand-ink hover:bg-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            {stepIndex === 0 ? t("nav.home") : t("nav.back")}
          </button>

          {step !== "summary" ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="inline-flex items-center gap-2 bg-brand-navy text-white px-8 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("nav.next")}
              <ChevronRight className="w-5 h-5" />
            </button>
          ) : !postSubmitNotice ? (
            <button
              onClick={() => handleSubmit()}
              disabled={!canProceed() || isSubmitting}
              className="inline-flex items-center gap-2 bg-brand-navy text-white px-8 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t("nav.saving") : b2bReviewRequired ? t("nav.submitB2b") : t("nav.reserveNow")}
              <ChevronRight className="w-5 h-5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => {
            // v8.3 fix (auditoría 2026-07-15): si el usuario cierra el modal
            // con la "X" sin autenticarse, la flag lulu_pending_auth_quote
            // (marcada por markPendingAuth() antes de abrir el modal)
            // quedaba en "true" indefinidamente -- si volvía a /cotizador
            // por URL horas después (dentro de la ventana de 1h de
            // localStorage), el sistema intentaba restaurar una cotización
            // vieja que el usuario no pidió recuperar.
            clearPendingAuth();
            setShowAuthModal(false);
            setAuthErrorMessage("");
            setNeedsPhoneVerification(false);
            setPendingSubmitUserId(null);
          }}
          onSuccess={needsPhoneVerification ? handlePhoneVerified : handleAuthSuccess}
          initialError={authErrorMessage}
          forcePhoneVerification={needsPhoneVerification}
        />
      )}
    </main>
  );
}

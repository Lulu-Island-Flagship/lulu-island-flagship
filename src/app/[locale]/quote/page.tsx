"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { QuoteInput, QuoteData, CotizadorStep } from "@/types";
import { supabase } from "@/lib/supabase";
import { StepEstimate, type QuickEstimate } from "@/components/cotizador/StepEstimate";
import { StepOrganic } from "@/components/cotizador/StepOrganic";
import { StepRecency } from "@/components/cotizador/StepRecency";
import { StepVerifyProperty, type VerifiedProperty } from "@/components/cotizador/StepVerifyProperty";
import { PriceBreakdown } from "@/components/cotizador/PriceBreakdown";
import { ServiceDetails } from "@/components/cotizador/ServiceDetails";
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
  "estimate",
  "organic",
  "recency",
  "verify",
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
  const searchParams = useSearchParams();
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
  // v8.4: email y teléfono para crear cuenta automática si el cliente no está autenticado
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAuthenticated(!!user);
    });
  }, []);
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
  }, [t]);

  useEffect(() => {
    const pendingAuth = wasPendingAuth();

    // Fix (2026-08-07): si el usuario viene de la landing page con
    // ?address=..., se salta el paso "address" directo a "verify" y
    // se pre-llena la dirección. También se consulta BC Assessment.
    const urlAddress = searchParams.get("address");
    const urlSqft = searchParams.get("sqft");

    if (urlAddress && !pendingAuth) {
      const decoded = decodeURIComponent(urlAddress);
      setInput((prev) => ({
        ...prev,
        address: decoded,
        bedrooms: prev.bedrooms ?? 2,
        bathrooms: prev.bathrooms ?? 1,
        squareFeet: urlSqft ? parseInt(urlSqft, 10) || 1000 : (prev.squareFeet ?? 1000),
        petsCount: prev.petsCount ?? 0,
        petsType: prev.petsType ?? "none",
        residents: prev.residents ?? 2,
        daysSinceCleaning: prev.daysSinceCleaning ?? 30,
      }));
      setStepIndex(0); // start at estimate — user needs to fill service type, zone, pets, recency
      // Limpiar params de la URL sin recargar
      window.history.replaceState({}, "", window.location.pathname);
      setIsHydrated(true);
      return;
    }

    const saved = loadStateFromStorage();
    if (pendingAuth || saved) {
      if (saved) {
        // Fix (2026-08-07): stepIndex validado contra STEPS.length
        const safeIndex = saved.stepIndex >= 0 && saved.stepIndex < STEPS.length
          ? saved.stepIndex
          : 0;
        setStepIndex(safeIndex);
        setInput(saved.input);
      }
      if (pendingAuth) clearPendingAuth();
    } else {
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
    setIsHydrated(true);
  }, [t, searchParams]);

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

function buildValidQuoteInput(raw: Partial<QuoteInput>): QuoteInput {
  const category = (raw.serviceCategory as "home" | "commercial") || "home";
  const defaultSubtype = category === "home" ? "regular" : "office";
  const validSubtypes = category === "home"
    ? ["first_time", "regular", "move_in_out"]
    : ["office", "airbnb", "post_construction"];
  const subtype = (raw.serviceSubtype && validSubtypes.includes(raw.serviceSubtype))
    ? raw.serviceSubtype
    : defaultSubtype;

  const subtypeMap: Record<string, "regular" | "deep" | "move_in_out" | "post_construction"> = {
    first_time: "deep",
    regular: "regular",
    move_in_out: "move_in_out",
    office: "regular",
    airbnb: "regular",
    post_construction: "post_construction",
  };
  const serviceType = subtypeMap[subtype] || "regular";

  const validZones = ["Richmond", "Vancouver West", "Vancouver East", "Kitsilano", "UBC"];
  const zone = (raw.zone && validZones.includes(raw.zone)) ? raw.zone : "Richmond";

  const validPets = ["none", "short_hair", "long_hair", "multiple"];
  const petsType = (raw.petsType && validPets.includes(raw.petsType)) ? raw.petsType : "none";

  const zonePostalMap: Record<string, string> = {
    Richmond: "V7C1T6",
    "Vancouver West": "V6J1A1",
    "Vancouver East": "V5N1A1",
    Kitsilano: "V6K1A1",
    UBC: "V6T1Z4",
  };
  const cleanPostal = (raw.postalCode || "").replace(/\s/g, "").toUpperCase();
  const postalCode = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(cleanPostal)
    ? cleanPostal
    : (zonePostalMap[zone] || "V7C1T6");

  const address = (raw.address && raw.address.trim().length >= 5)
    ? raw.address.trim()
    : `${zone}, BC`;

  return {
    serviceCategory: category,
    serviceSubtype: subtype,
    serviceType: serviceType,
    bedrooms: raw.bedrooms ?? 2,
    bathrooms: raw.bathrooms ?? 1,
    squareFeet: Math.max(300, Math.min(10000, raw.squareFeet ?? 1000)),
    petsCount: raw.petsCount ?? 0,
    petsType: petsType as QuoteInput["petsType"],
    residents: Math.max(1, raw.residents ?? 2),
    daysSinceCleaning: raw.daysSinceCleaning ?? 30,
    address: address,
    zone: zone,
    postalCode: postalCode,
    dayOfWeek: raw.dayOfWeek,
    isPreferredDay: raw.isPreferredDay,
    addonZones: raw.addonZones,
    squareFeetDeclared: raw.squareFeetDeclared,
  };
}

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const fetchPreviewQuote = useCallback(async (signal?: AbortSignal) => {
    const effectiveInput = buildValidQuoteInput(input);

    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await fetch("/api/quote/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(effectiveInput),
        signal,
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
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const message = err instanceof Error ? err.message : t("errors.genericPreview");
      setPreviewError(message);
      setQuote(null);
    } finally {
      if (!signal?.aborted) {
        setPreviewLoading(false);
      }
    }
  }, [input, t]);

  useEffect(() => {
    if (step === "summary") {
      const controller = new AbortController();
      fetchPreviewQuote(controller.signal);
      return () => controller.abort();
    }
  }, [step, fetchPreviewQuote]);

  const canProceed = () => {
    switch (step) {
      case "estimate":
        return (
          !!input.serviceCategory &&
          !!input.serviceSubtype &&
          !!input.zone &&
          input.squareFeet !== undefined
        );
      case "verify":
        return true;
      case "organic":
        return (
          input.residents !== undefined &&
          input.residents >= 1 &&
          input.petsCount !== undefined
        );
      case "recency":
        return input.daysSinceCleaning !== undefined;
      case "summary":
        return (
          consents.tc &&
          (!b2bReviewRequired || purchaseOrder.trim().length > 0) &&
          !!quote &&
          !previewLoading &&
          !previewError
        );
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (stepIndex === 0) {
      const pathLocale = window.location.pathname.split("/")[1];
      const locale = ["en", "zh", "fr"].includes(pathLocale) ? pathLocale : "en";
      router.push(`/${locale}`);
      return;
    }
    setStepIndex((prev) => prev - 1);
  };

  const [postSubmitNotice, setPostSubmitNotice] = useState<{
    quoteId: string;
    profileWarning?: boolean;
    adminReviewRequired?: boolean;
  } | null>(null);

  const goToReservation = (quoteId: string) => {
    clearStateFromStorage();
    const pathLocale = window.location.pathname.split("/")[1];
    const locale = ["en", "zh", "fr"].includes(pathLocale) ? pathLocale : "en";
    router.push(`/${locale}/booking/${quoteId}`);
  };

  const handleSubmit = async (forcedUserId?: string) => {
    if (!quote) return;
    if (!consents.tc) {
      setSubmitError(t("errors.acceptTerms"));
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      let currentUserId = forcedUserId;
      if (!currentUserId) {
        const { data: { user } } = await supabase.auth.getUser();
        currentUserId = user?.id;
      }

      if (!currentUserId) {
        // v8.4: en vez de bloquear con AuthModal, pedimos email de contacto
        // y mandamos todo al backend — el servidor crea la cuenta automáticamente
        if (!contactEmail || !contactEmail.includes("@")) {
          setSubmitError(t("errors.emailRequired"));
          setIsSubmitting(false);
          return;
        }
      }

      const validPayload = buildValidQuoteInput(input);
      const rawInputs = {
        ...validPayload,
        consentTc: consents.tc,
        consentPipa: consents.pipa,
        consentMarketing: consents.marketing,
        consentPhotoMarketing: consents.photoMarketing,
        purchaseOrder: purchaseOrder.trim() || undefined,
        preferredLanguages,
        acquisitionChannel: acquisitionChannel || "other",
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
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
      let smsConfigured = false;
      try {
        const statusRes = await fetch("/api/system/sms-status");
        const statusData = await statusRes.json();
        smsConfigured = Boolean(statusData?.configured);
      } catch {
        smsConfigured = false;
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
          {step === "estimate" && (
            <StepEstimate
              initial={{
                serviceCategory: input.serviceCategory,
                serviceSubtype: input.serviceSubtype,
                squareFeet: input.squareFeet,
                zone: input.zone,
                address: input.address,
              }}
              onChange={(data: QuickEstimate) => {
                updateInput({
                  serviceCategory: data.serviceCategory,
                  serviceSubtype: data.serviceSubtype,
                  serviceType: data.serviceType,
                  squareFeet: data.squareFeet,
                  zone: data.zone,
                  address: data.address,
                });
              }}
            />
          )}
          {step === "verify" && (
            <StepVerifyProperty
              rawAddress={input.address ?? ""}
              initial={{
                address: input.address,
                zone: input.zone,
                postalCode: input.postalCode,
                serviceCategory: input.serviceCategory,
                bedrooms: input.bedrooms,
                bathrooms: input.bathrooms,
                squareFeet: input.squareFeet,
                squareFeetDeclared: input.squareFeetDeclared,
              }}
              onChange={(data: VerifiedProperty) => {
                updateInput({
                  address: data.address,
                  zone: data.zone,
                  postalCode: data.postalCode,
                  serviceCategory: data.serviceCategory,
                  bedrooms: data.bedrooms,
                  bathrooms: data.bathrooms,
                  squareFeet: data.squareFeet,
                  squareFeetDeclared: data.squareFeetDeclared,
                });
              }}
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

              {!previewLoading && !previewError && !quote && (
                <div className="p-4 bg-brand-navy/5 border border-brand-navy/10 rounded-lg text-sm text-center space-y-3">
                  <p className="text-brand-ink font-medium">{t("summary.calculating")}</p>
                  <button
                    type="button"
                    onClick={() => fetchPreviewQuote()}
                    className="inline-flex items-center gap-2 bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-navy-light transition-colors"
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

                  <ServiceDetails quote={quote} />

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

                  {/* v8.4: si no está autenticado, pedir email y teléfono para crear cuenta automática */}
                  {!isAuthenticated && (
                    <div className="space-y-3 p-4 bg-brand-navy/5 rounded-lg border border-brand-navy/10">
                      <p className="text-sm font-semibold text-brand-ink">
                        {t("summary.contactTitle")}
                      </p>
                      <p className="text-xs text-gray-500 -mt-1">
                        {t("summary.contactSubtitle")}
                      </p>
                      <input
                        id="contact-email"
                        type="email"
                        autoComplete="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder={t("summary.emailPlaceholder")}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
                      />
                      <input
                        id="contact-phone"
                        type="tel"
                        autoComplete="tel"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        placeholder={t("summary.phonePlaceholder")}
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold text-sm"
                      />
                    </div>
                  )}

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

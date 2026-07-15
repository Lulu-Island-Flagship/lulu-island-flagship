"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
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

const STEP_LABELS: Record<CotizadorStep, string> = {
  category: "Category",
  purpose: "Service Type",
  dimensions: "Dimensions",
  addonZones: "Extras",
  organic: "Household",
  recency: "Recency",
  address: "Location",
  summary: "Summary",
};

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
        provider_error: "Sign-in was cancelled or failed with your provider. Please try again.",
        session_exchange_failed: "We couldn't complete sign-in. Please try again.",
        missing_code: "Sign-in link is invalid or expired. Please try again.",
      };
      setAuthErrorMessage(messages[authError] || "Sign-in failed. Please try again.");
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
    if (pendingAuth) {
      const saved = loadStateFromStorage();
      if (saved) {
        setStepIndex(saved.stepIndex);
        setInput(saved.input);
      }
      clearPendingAuth();
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
        throw new Error(err.error || "Failed to calculate preview");
      }

      const data = await response.json();
      const q = data.quote as QuoteData;
      setQuote(q);
      setPriceFrozenUntil(new Date(q.priceFrozenUntil));
    } catch (err: Error | unknown) {
      const message = err instanceof Error ? err.message : "Failed to calculate preview";
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

  const handleNext = () => {
    if (stepIndex < STEPS.length - 1) {
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
    setStepIndex((prev) => prev - 1);
  };

  const handleSubmit = async (forcedUserId?: string) => {
    if (!quote) return;
    if (!consents.tc) {
      setSubmitError("Please accept the Terms & Conditions to proceed.");
      return;
    }
    if (!acquisitionChannel) {
      setSubmitError("Please let us know how you heard about us.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      // Always verify session fresh from Supabase before trusting it
      let currentUserId = forcedUserId;
      if (!currentUserId) {
        const { data: { session } } = await supabase.auth.getSession();
        currentUserId = session?.user?.id;
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
        throw new Error(err.error || "Failed to save quote");
      }

      const {
        quoteId,
        adminReviewRequired,
        b2bReviewRequired,
      } = await response.json();

      if (b2bReviewRequired) {
        setSubmitError(
          "Commercial / B2B bookings require manual onboarding and PO setup. Our team will contact you shortly."
        );
        clearStateFromStorage();
        setIsSubmitting(false);
        return;
      }

      if (adminReviewRequired) {
        // No bloqueamos la reserva, pero mostramos advertencia y loggeamos
        console.warn("Quote requires admin review before scheduling.");
      }

      // Clear saved state and redirect to reservation with locale
      clearStateFromStorage();
      const pathLocale = window.location.pathname.split("/")[1];
      const locale = ["en", "zh", "fr"].includes(pathLocale) ? pathLocale : "en";
      router.push(`/${locale}/reserva/${quoteId}`);
    } catch (err: Error | unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save quote. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      if (data.user) {
        // Pass the user ID directly to avoid stale closure
        handleSubmit(data.user.id);
      }
    } catch (err: Error | unknown) {
      setSubmitError(err instanceof Error ? err.message : "Authentication failed. Please try again.");
      setShowAuthModal(true);
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
            <span className="font-semibold">Lulu Island Flagship</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <Clock className="w-4 h-4" />
            {priceFrozenUntil && step !== "summary" && (
              <span>
                Price locked until{" "}
                {priceFrozenUntil.toLocaleTimeString("en-CA", {
                  timeZone: "America/Vancouver",
                  hour: "2-digit",
                  minute: "2-digit",
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
              Step {stepIndex + 1} of {STEPS.length}
            </span>
            <span className="text-sm text-gray-500">
              {STEP_LABELS[step]}
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
              address={input.address}
              onChange={(vals) => updateInput(vals)}
            />
          )}
          {step === "addonZones" && (
            <StepAddonZones
              serviceSubtype={input.serviceSubtype}
              targetHourlyRate={TARIFA_OBJETIVO_HORA}
              selected={input.addonZones ?? []}
              onChange={(zones) => updateInput({ addonZones: zones })}
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
                  <p className="text-sm text-gray-600">Calculating your server-verified quote...</p>
                </div>
              )}

              {!previewLoading && previewError && (
                <div className="p-4 bg-state-danger/10 text-state-danger rounded-lg text-sm text-center">
                  {previewError}
                </div>
              )}

              {!previewLoading && !previewError && quote && (
                <>
                  <div className="text-center">
                    <CheckCircle2 className="w-12 h-12 text-state-success mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-brand-ink mb-2">
                      Your Quote is Ready
                    </h2>
                    <p className="text-gray-600">
                      Full price upfront — no surprises.
                    </p>
                  </div>

                  {b2bReviewRequired && (
                    <div className="p-4 bg-state-warning/10 border border-state-warning/20 rounded-lg">
                      <p className="text-sm font-medium text-state-warning">
                        Commercial / B2B Quote
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        This quote requires manual onboarding, PO process, and Net-30 setup before booking.
                        Submitting will notify our sales team.
                      </p>
                    </div>
                  )}

                  <PriceBreakdown quote={quote} />

                  {b2bReviewRequired && (
                    <div className="p-4 bg-brand-navy/5 border border-brand-navy/10 rounded-lg">
                      <label className="block text-sm font-medium text-brand-ink mb-1">
                        Purchase Order (PO) Number *
                      </label>
                      <input
                        type="text"
                        value={purchaseOrder}
                        onChange={(e) => setPurchaseOrder(e.target.value)}
                        placeholder="PO-2026-0001"
                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-gold"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        B2B / Government bookings require a PO before onboarding.
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
                </>
              )}

              {submitError && (
                <div className="p-4 bg-state-danger/10 text-state-danger rounded-lg text-sm">
                  {submitError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={handleBack}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-brand-ink hover:bg-white transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            {stepIndex === 0 ? "Home" : "Back"}
          </button>

          {step !== "summary" ? (
            <button
              onClick={handleNext}
              disabled={!canProceed()}
              className="inline-flex items-center gap-2 bg-brand-navy text-white px-8 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              disabled={!canProceed() || isSubmitting}
              className="inline-flex items-center gap-2 bg-brand-navy text-white px-8 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Saving..." : b2bReviewRequired ? "Submit for B2B Review" : "Reserve Now"}
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => { setShowAuthModal(false); setAuthErrorMessage(""); }}
          onSuccess={handleAuthSuccess}
          initialError={authErrorMessage}
        />
      )}
    </main>
  );
}

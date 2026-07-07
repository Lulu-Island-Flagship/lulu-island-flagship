"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { QuoteInput, QuoteData, CotizadorStep } from "@/types";
import { calculatePrice, ServiceType } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
import { StepCategory } from "@/components/cotizador/StepCategory";
import { StepPurpose } from "@/components/cotizador/StepPurpose";
import { StepDimensions } from "@/components/cotizador/StepDimensions";
import { StepOrganic } from "@/components/cotizador/StepOrganic";
import { StepRecency } from "@/components/cotizador/StepRecency";
import { StepAddress } from "@/components/cotizador/StepAddress";
import { PriceBreakdown } from "@/components/cotizador/PriceBreakdown";
import { ConsentCheck } from "@/components/cotizador/ConsentCheck";
import { AuthModal } from "@/components/cotizador/AuthModal";
import {
  ChevronLeft,
  ChevronRight,
  Shield,
  Clock,
  CheckCircle2,
} from "lucide-react";

const STEPS: CotizadorStep[] = [
  "category",
  "purpose",
  "dimensions",
  "organic",
  "recency",
  "address",
  "summary",
];

const STEP_LABELS: Record<CotizadorStep, string> = {
  category: "Category",
  purpose: "Service Type",
  dimensions: "Dimensions",
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
  });
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Keep auth listener for UI state (e.g. showing logged-in status)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<{ id: string } | null>(null);

  // Restaurar estado desde localStorage SOLO si venimos de un login pendiente
  // (pending_auth_quote). Si no, empezamos desde cero (cotización nueva).
  useEffect(() => {
    const pendingAuth = wasPendingAuth();
    if (pendingAuth) {
      const saved = loadStateFromStorage();
      if (saved) {
        setStepIndex(saved.stepIndex);
        setInput(saved.input);
      }
      clearPendingAuth();
    }
    // Si no hay pending_auth, empezamos desde cero (stepIndex=0, input={})
    setIsHydrated(true);
  }, []);

  const step = STEPS[stepIndex];

  // Check auth status
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id });
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ? { id: session.user.id } : null);
      }
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  // Price freeze: 10 min from last interaction
  useEffect(() => {
    if (stepIndex < STEPS.length - 1) {
      const freeze = new Date(Date.now() + 10 * 60 * 1000);
      setPriceFrozenUntil(freeze);
    }
  }, [stepIndex, input]);

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

  const calculateQuote = useCallback((): QuoteData | null => {
    if (
      !input.serviceType ||
      !input.squareFeet ||
      input.petsCount === undefined ||
      input.petsType === undefined ||
      !input.residents ||
      input.daysSinceCleaning === undefined ||
      !input.zone
    ) {
      return null;
    }

    const breakdown = calculatePrice(
      input.serviceType as ServiceType,
      input.squareFeet,
      input.petsCount,
      input.petsType,
      input.residents,
      input.daysSinceCleaning,
      input.zone,
      input.dayOfWeek,
      input.isPreferredDay
    );

    const freeze = new Date(Date.now() + 10 * 60 * 1000);

    return {
      ...input,
      basePrice: breakdown.basePrice,
      organicMultiplier: breakdown.organicMultiplier,
      organicAdjustment: breakdown.organicAdjustment,
      recencyMultiplier: breakdown.recencyMultiplier,
      recencyAdjustment: breakdown.recencyAdjustment,
      zoneSurcharge: breakdown.zoneSurcharge,
      logisticsSurcharge: breakdown.logisticsSurcharge,
      subtotal: breakdown.subtotal,
      gst: breakdown.gst,
      pst: breakdown.pst,
      total: breakdown.total,
      holdAmount: breakdown.holdAmount,
      priceFrozenUntil: freeze.toISOString(),
      status: "pending",
      // Los consents no afectan el precio — se agregan solo al guardar
      consentTc: false,
      consentPipa: false,
      consentMarketing: false,
      clientScore: 50,
    } as QuoteData;
  }, [input]);

  useEffect(() => {
    if (step === "summary") {
      const q = calculateQuote();
      setQuote(q);
    }
  }, [step, calculateQuote]);

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
      case "organic":
        return (
          input.petsCount !== undefined &&
          input.residents !== undefined
        );
      case "recency":
        return input.daysSinceCleaning !== undefined;
      case "address":
        return !!input.address && !!input.zone && !!input.postalCode;
      case "summary":
        return consents.tc && consents.pipa;
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
      // En el primer paso, volver a la landing page
      router.push("/");
      return;
    }
    setStepIndex((prev) => prev - 1);
  };

  const handleSubmit = async (forcedUserId?: string) => {
    if (!quote) return;
    if (!consents.tc || !consents.pipa) {
      setSubmitError("Please accept the Terms & Conditions and Privacy consent.");
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

      // Save quote via API to get quoteId
      const response = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...quote,
          user_id: currentUserId,
          consentTc: consents.tc,
          consentPipa: consents.pipa,
          consentMarketing: consents.marketing,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to save quote");
      }

      const { quoteId } = await response.json();

      // Clear saved state and redirect to reservation
      clearStateFromStorage();
      router.push(`/reserva/${quoteId}`);
    } catch (err: Error | unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save quote. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      setUser({ id: data.user.id });
      // Pass the user ID directly to avoid stale closure
      handleSubmit(data.user.id);
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
              onChange={(vals) => updateInput(vals)}
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
            />
          )}
          {step === "summary" && quote && (
            <div className="space-y-6">
              <div className="text-center">
                <CheckCircle2 className="w-12 h-12 text-state-success mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-brand-ink mb-2">
                  Your Quote is Ready
                </h2>
                <p className="text-gray-600">
                  Full price upfront — no surprises.
                </p>
              </div>

              <PriceBreakdown quote={quote} />

              <ConsentCheck
                consents={consents}
                onChange={setConsents}
              />

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
              className="inline-flex items-center gap-2 bg-brand-gold text-brand-navy px-8 py-3 rounded-lg font-semibold hover:bg-brand-gold-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Saving..." : "Reserve Now"}
              <ChevronRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
        />
      )}
    </main>
  );
}

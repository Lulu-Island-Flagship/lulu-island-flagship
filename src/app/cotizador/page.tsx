"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { QuoteInput, QuoteData, CotizadorStep } from "@/types";
import { calculatePrice, ServiceType } from "@/lib/pricing";
import { supabase } from "@/lib/supabase";
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
  "purpose",
  "dimensions",
  "organic",
  "recency",
  "address",
  "summary",
];

const STEP_LABELS: Record<CotizadorStep, string> = {
  purpose: "Service Type",
  dimensions: "Dimensions",
  organic: "Household",
  recency: "Recency",
  address: "Location",
  summary: "Summary",
};

export default function CotizadorPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [input, setInput] = useState<Partial<QuoteInput>>({});
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
  const [user, setUser] = useState<{ id: string } | null>(null);

  const step = STEPS[stepIndex];

  // Check auth status
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
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
      !input.petsCount === undefined ||
      !input.petsType === undefined ||
      !input.residents ||
      !input.daysSinceCleaning === undefined ||
      !input.zone
    ) {
      return null;
    }

    const breakdown = calculatePrice(
      input.serviceType as ServiceType,
      input.squareFeet ?? 1000,
      input.petsCount ?? 0,
      input.petsType ?? "",
      input.residents ?? 2,
      input.daysSinceCleaning ?? 30,
      input.zone ?? "",
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
      consentTc: consents.tc,
      consentPipa: consents.pipa,
      consentMarketing: consents.marketing,
      clientScore: 50,
    } as QuoteData;
  }, [input, consents]);

  useEffect(() => {
    if (step === "summary") {
      const q = calculateQuote();
      setQuote(q);
    }
  }, [step, calculateQuote]);

  const canProceed = () => {
    switch (step) {
      case "purpose":
        return !!input.serviceType;
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
    if (stepIndex > 0) {
      setStepIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (!quote) return;
    if (!consents.tc || !consents.pipa) {
      setSubmitError("Please accept the Terms & Conditions and Privacy consent.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      // If not logged in, show auth modal
      if (!user) {
        setShowAuthModal(true);
        setIsSubmitting(false);
        return;
      }

      // Save quote
      const { error } = await supabase.from("quotes").insert({
        ...quote,
        user_id: user.id,
      });

      if (error) throw error;

      // Redirect to confirmation
      router.push("/confirmacion");
    } catch (err: Error | unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save quote. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);
    setUser((await supabase.auth.getUser()).data.user);
    // Retry submit
    handleSubmit();
  };

  const progress = ((stepIndex + 1) / STEPS.length) * 100;

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
                {priceFrozenUntil.toLocaleTimeString([], {
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
          {step === "purpose" && (
            <StepPurpose
              value={input.serviceType as ServiceType}
              onChange={(val) => updateInput({ serviceType: val })}
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
            disabled={stepIndex === 0}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-brand-ink hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
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
              onClick={handleSubmit}
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

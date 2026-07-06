"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Elements } from "@stripe/react-stripe-js";
import { QuoteData } from "@/types";
import { supabase } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe-client";
import { DatePicker } from "@/components/reserva/DatePicker";
import { TimeSlotPicker } from "@/components/reserva/TimeSlotPicker";
import { StripeCardForm } from "@/components/reserva/StripeCardForm";
import { ReservationSummary } from "@/components/reserva/ReservationSummary";
import {
  ChevronLeft,
  Shield,
  Calendar,
  CreditCard,
  CheckCircle2,
  Loader2,
} from "lucide-react";

export default function ReservaPage() {
  const router = useRouter();
  const params = useParams();
  const quoteId = params?.quoteId as string;

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [serviceDate, setServiceDate] = useState("");
  const [serviceTime, setServiceTime] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [stripeClientSecret, setStripeClientSecret] = useState("");
  const [stripeCustomerId, setStripeCustomerId] = useState("");

  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  // Fetch quote
  useEffect(() => {
    async function loadQuote() {
      if (!quoteId) {
        setError("Invalid quote ID.");
        setLoading(false);
        return;
      }

      const { data, error: supaError } = await supabase
        .from("quotes")
        .select("*")
        .eq("id", quoteId)
        .single();

      if (supaError || !data) {
        setError("Quote not found or expired.");
        setLoading(false);
        return;
      }

      // Check price freeze
      const frozenUntil = new Date(data.price_frozen_until);
      if (frozenUntil < new Date()) {
        setError("This quote has expired. Please generate a new quote.");
        setLoading(false);
        return;
      }

      setQuote(data as QuoteData);
      setLoading(false);
    }

    loadQuote();
  }, [quoteId]);

  // Create SetupIntent when date/time selected and user authenticated
  useEffect(() => {
    async function createSetupIntent() {
      if (!serviceDate || !serviceTime || !quote) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      try {
        const res = await fetch("/api/stripe/setup-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: quote.id,
            userId: user.id,
            email: user.email,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error("SetupIntent error:", err.error);
          return;
        }

        const { clientSecret, customerId } = await res.json();
        setStripeClientSecret(clientSecret);
        setStripeCustomerId(customerId);
      } catch (e) {
        console.error("Failed to create SetupIntent:", e);
      }
    }

    createSetupIntent();
  }, [serviceDate, serviceTime, quote]);

  const handlePaymentMethodReady = (pmId: string) => {
    setPaymentMethodId(pmId);
  };

  const handleConfirm = async () => {
    if (!quote || !serviceDate || !serviceTime || !paymentMethodId) {
      setConfirmError("Please complete all steps before confirming.");
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
          stripeCustomerId,
          holdAmount: quote.holdAmount,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to confirm reservation.");
      }

      const { orderId } = await res.json();
      router.push(`/confirmacion?orderId=${orderId}`);
    } catch (err: Error | unknown) {
      setConfirmError(
        err instanceof Error ? err.message : "Failed to confirm reservation."
      );
    } finally {
      setIsConfirming(false);
    }
  };

  const stripePromise = getStripe();

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
            onClick={() => router.push("/cotizador")}
            className="inline-flex items-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            New Quote
          </button>
        </div>
      </main>
    );
  }

  if (!quote) return null;

  const stepLabels = [
    { icon: Calendar, label: "Date & Time", done: !!serviceDate && !!serviceTime },
    { icon: CreditCard, label: "Card", done: !!paymentMethodId },
    { icon: CheckCircle2, label: "Confirm", done: false },
  ];

  return (
    <main className="min-h-screen bg-brand-ice">
      {/* Header */}
      <header className="bg-brand-navy text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-gold" />
            <span className="font-semibold">Lulu Island Flagship</span>
          </div>
          <span className="text-sm text-gray-300">Complete Your Reservation</span>
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
                When do you need us?
              </h2>
              <div className="space-y-4">
                <DatePicker value={serviceDate} onChange={setServiceDate} />
                {serviceDate && (
                  <TimeSlotPicker value={serviceTime} onChange={setServiceTime} />
                )}
              </div>
            </div>

            {/* Card */}
            {serviceDate && serviceTime && stripeClientSecret && (
              <div className="bg-white rounded-lg shadow-elevation-1 p-6">
                <h2 className="text-lg font-semibold text-brand-ink mb-4 flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-brand-gold" />
                  Payment Method
                </h2>
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret: stripeClientSecret,
                    appearance: { theme: "stripe" as const },
                  }}
                >
                  <StripeCardForm
                    onPaymentMethodReady={handlePaymentMethodReady}
                    disabled={isConfirming}
                  />
                </Elements>
              </div>
            )}

            {serviceDate && serviceTime && !stripeClientSecret && (
              <div className="bg-white rounded-lg shadow-elevation-1 p-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-brand-gold mx-auto mb-2" />
                <p className="text-sm text-gray-500">Preparing secure checkout...</p>
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

            {/* Confirm button */}
            {paymentMethodId && (
              <div className="bg-white rounded-lg shadow-elevation-1 p-6">
                {confirmError && (
                  <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm mb-4">
                    {confirmError}
                  </div>
                )}
                <button
                  onClick={handleConfirm}
                  disabled={isConfirming}
                  className="w-full inline-flex items-center justify-center gap-2 bg-brand-gold text-brand-navy px-6 py-3 rounded-lg font-semibold hover:bg-brand-gold-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConfirming ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Confirm Reservation
                    </>
                  )}
                </button>
                <p className="text-xs text-gray-500 mt-3 text-center">
                  By confirming, you agree to our cancellation policy. Hold
                  authorization applies 72h before service.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

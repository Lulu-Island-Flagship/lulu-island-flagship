"use client";

import React, { useState } from "react";
import {
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { CreditCard, ShieldCheck, MapPin } from "lucide-react";

interface StripeCardFormProps {
  onPaymentMethodReady: (paymentMethodId: string) => void;
  disabled?: boolean;
  clientSecret: string;
}

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "16px",
      color: "#1a1a2e",
      "::placeholder": { color: "#9ca3af" },
    },
    invalid: { color: "#ef4444" },
  },
  hidePostalCode: true,
};

function formatCanadianPostalCode(value: string): string {
  // Remove all non-alphanumeric characters
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
  // Format as ANA NAN (letter-number-letter number-letter-number)
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
}

function isValidCanadianPostalCode(code: string): boolean {
  const pattern = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
  return pattern.test(code);
}

export function StripeCardForm({ onPaymentMethodReady, disabled, clientSecret }: StripeCardFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [postalCode, setPostalCode] = useState("");

  const handlePostalCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCanadianPostalCode(e.target.value);
    setPostalCode(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    if (!isValidCanadianPostalCode(postalCode)) {
      setError("Please enter a valid Canadian postal code (e.g., V6X 1A1).");
      return;
    }

    setIsProcessing(true);
    setError("");

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError("Card element not found.");
      setIsProcessing(false);
      return;
    }

    const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(
      clientSecret,
      {
        payment_method: {
          card: cardElement,
          billing_details: {
            address: {
              postal_code: postalCode.replace(/\s/g, ""),
              country: "CA",
            },
          },
        },
      }
    );

    if (stripeError) {
      setError(stripeError.message || "Card validation failed.");
      setIsProcessing(false);
      return;
    }

    if (setupIntent?.payment_method) {
      onPaymentMethodReady(setupIntent.payment_method as string);
    }

    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-brand-ink">
          Card Details
        </label>
        <div className="p-4 rounded-lg border border-gray-200 bg-white">
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="stripe-postal-code-input" className="block text-sm font-medium text-brand-ink">
          Postal Code
        </label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="stripe-postal-code-input"
            type="text"
            value={postalCode}
            onChange={handlePostalCodeChange}
            placeholder="V6X 1A1"
            maxLength={7}
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:border-brand-gold focus:ring-1 focus:ring-brand-gold outline-none text-brand-ink uppercase"
          />
        </div>
        <p className="text-xs text-gray-500">
          Canadian format: letter-number-letter space number-letter-number
        </p>
      </div>

      {error && (
        <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">
          {error}
        </div>
      )}

      <button
        aria-label="Guardar tarjeta de pago"
        type="submit"
        disabled={!stripe || disabled || isProcessing}
        className="w-full inline-flex items-center justify-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <CreditCard className="w-5 h-5" />
        {isProcessing ? "Validating..." : "Save Card"}
      </button>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <ShieldCheck className="w-4 h-4" />
        <span>
          Your card is tokenized securely by Stripe. We never store card numbers.
        </span>
      </div>
    </form>
  );
}

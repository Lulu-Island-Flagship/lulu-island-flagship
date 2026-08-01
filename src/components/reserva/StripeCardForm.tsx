"use client";

import React, { useState } from "react";
import {
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("reserva.stripeCardForm");
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
      setError(t("invalidPostalCode"));
      return;
    }

    setIsProcessing(true);
    setError("");

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError(t("cardElementNotFound"));
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
      setError(stripeError.message || t("cardValidationFailed"));
      setIsProcessing(false);
      return;
    }

    // Fix (auditoría externa, verificado 2026-07-31): antes se llamaba a
    // onPaymentMethodReady con solo chequear que setupIntent.payment_method
    // existiera, sin verificar setupIntent.status === "succeeded". Aunque
    // confirmCardSetup normalmente resuelve con stripeError seteado para la
    // mayoría de fallos, algunos estados intermedios (ej. "processing",
    // "requires_action" sin error explícito) pueden devolver un
    // setupIntent con payment_method ya asociado pero SIN estar realmente
    // listo para cobros off_session futuros -- tratarlo como listo podría
    // hacer que el checkout avanzara con un método de pago que Stripe
    // todavía no confirmó del todo.
    if (setupIntent?.status === "succeeded" && setupIntent.payment_method) {
      onPaymentMethodReady(setupIntent.payment_method as string);
    } else if (setupIntent && setupIntent.status !== "succeeded") {
      setError(t("cardValidationFailed"));
    }

    setIsProcessing(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-brand-ink">
          {t("cardDetailsLabel")}
        </label>
        <div className="p-4 rounded-lg border border-gray-200 bg-white">
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="stripe-postal-code-input" className="block text-sm font-medium text-brand-ink">
          {t("postalCodeLabel")}
        </label>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            id="stripe-postal-code-input"
            type="text"
            value={postalCode}
            onChange={handlePostalCodeChange}
            placeholder={t("postalCodePlaceholder")}
            maxLength={7}
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 focus:border-brand-gold focus:ring-1 focus:ring-brand-gold outline-none text-brand-ink uppercase"
          />
        </div>
        <p className="text-xs text-gray-500">
          {t("postalCodeHint")}
        </p>
      </div>

      {error && (
        <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">
          {error}
        </div>
      )}

      <button
        aria-label={t("saveCardAriaLabel")}
        type="submit"
        disabled={!stripe || disabled || isProcessing}
        className="w-full inline-flex items-center justify-center gap-2 bg-brand-navy text-white px-6 py-3 rounded-lg font-semibold hover:bg-brand-navy-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <CreditCard className="w-5 h-5" />
        {isProcessing ? t("validating") : t("saveButton")}
      </button>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <ShieldCheck className="w-4 h-4" />
        <span>
          {t("secureNote")}
        </span>
      </div>
    </form>
  );
}

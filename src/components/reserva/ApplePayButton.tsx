"use client";

import React, { useEffect, useState } from "react";
import {
  PaymentRequestButtonElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import type { PaymentRequest, PaymentRequestPaymentMethodEvent } from "@stripe/stripe-js";
import { useTranslations } from "next-intl";

interface ApplePayButtonProps {
  onPaymentMethodReady: (paymentMethodId: string) => void;
  disabled?: boolean;
  clientSecret: string;
  amountCents: number;
  label?: string;
}

/**
 * Apple Pay (and, opportunistically, Google Pay/other browser wallets --
 * Stripe's PaymentRequestButtonElement auto-detects whichever wallet the
 * device/browser supports) entry point for the reservation checkout.
 *
 * Business decision (2026-07-21): iOS/Apple Pay ships first; Android/Google
 * Pay is deferred (separate Google Pay merchant verification, not just a
 * Stripe Dashboard domain registration). This component doesn't need to be
 * touched to enable Google Pay later -- canMakePayment() already reports it
 * once Google Pay is set up on the Stripe account, this button will just
 * start rendering for those users too.
 *
 * Architecture note: this app tokenizes cards via a SetupIntent
 * (card-on-file, charged later by cron jobs), not an immediate
 * PaymentIntent charge (see StripeCardForm.tsx / setup-intent/route.ts).
 * A wallet-originated PaymentMethod from the Payment Request object is
 * still `type: "card"`, so it's fed through the exact same
 * confirmCardSetup() + onPaymentMethodReady() path as a manually-entered
 * card -- no backend changes needed.
 */
export function ApplePayButton({
  onPaymentMethodReady,
  disabled,
  clientSecret,
  amountCents,
  label = "Lulu Island Flagship",
}: ApplePayButtonProps) {
  const t = useTranslations("reserva.applePayButton");
  const stripe = useStripe();
  const elements = useElements();
  const [paymentRequest, setPaymentRequest] = useState<PaymentRequest | null>(null);
  const [canPay, setCanPay] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!stripe || amountCents <= 0) return;

    const pr = stripe.paymentRequest({
      country: "CA",
      currency: "cad",
      total: {
        label,
        // Payment Request total is display-only here (a SetupIntent has no
        // charge amount); it must still be > 0 for Apple Pay's sheet to
        // render a sensible confirmation amount to the client.
        amount: amountCents,
      },
      requestPayerName: true,
      requestPayerEmail: true,
    });

    pr.canMakePayment().then((result) => {
      setCanPay(!!result);
    });

    setPaymentRequest(pr);
  }, [stripe, amountCents, label]);

  useEffect(() => {
    if (!paymentRequest || !stripe) return;

    // Fix (2026-07-24): el handler tenía un tipo inline propio, estructuralmente
    // distinto de PaymentRequestPaymentMethodEvent real de @stripe/stripe-js.
    // Eso hacía que TS no pudiera resolver ninguna sobrecarga de .on()/.off()
    // para "paymentmethod" y reportara un error confuso apuntando a la última
    // sobrecarga ("shippingoptionchange"). Se usa el tipo real de la librería.
    const handler = async (event: PaymentRequestPaymentMethodEvent) => {
      if (!clientSecret) {
        event.complete("fail");
        setError(t("checkoutNotReady"));
        return;
      }

      const { error: confirmError, setupIntent } = await stripe.confirmCardSetup(
        clientSecret,
        { payment_method: event.paymentMethod.id },
        { handleActions: false }
      );

      if (confirmError) {
        event.complete("fail");
        setError(confirmError.message || t("validationFailed"));
        return;
      }

      event.complete("success");

      if (setupIntent?.payment_method) {
        onPaymentMethodReady(setupIntent.payment_method as string);
      }
    };

    paymentRequest.on("paymentmethod", handler);
    return () => {
      paymentRequest.off("paymentmethod", handler);
    };
  }, [paymentRequest, stripe, clientSecret, onPaymentMethodReady, t]);

  if (!elements || !paymentRequest || !canPay) {
    return null;
  }

  return (
    <div className={`space-y-2 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <PaymentRequestButtonElement
        options={{
          paymentRequest,
          style: {
            paymentRequestButton: {
              type: "default",
              theme: "dark",
              height: "48px",
            },
          },
        }}
      />
      {error && (
        <div className="p-3 bg-state-danger/10 text-state-danger rounded-lg text-sm">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>{t("orPayWithCard")}</span>
      </div>
    </div>
  );
}

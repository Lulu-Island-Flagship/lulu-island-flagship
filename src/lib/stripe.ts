import Stripe from "stripe";
import { loadStripe, Stripe as StripeJS } from "@stripe/stripe-js";
import { logEvent } from "@/lib/observability";

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  logEvent("stripe_secret_key_not_set", { module: "stripe" });
}

export const stripe = secretKey
  ? new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" })
  : null;

export function assertStripe(): Stripe {
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY in .env.local");
  }
  return stripe;
}

let stripePromise: Promise<StripeJS | null> | null = null;

export function getStripe(): Promise<StripeJS | null> {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      logEvent("stripe_publishable_key_not_set", { module: "stripe" });
      stripePromise = Promise.resolve(null);
    } else {
      stripePromise = loadStripe(publishableKey);
    }
  }
  return stripePromise;
}

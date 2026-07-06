import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.warn("STRIPE_SECRET_KEY is not set. Stripe server-side operations will fail.");
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

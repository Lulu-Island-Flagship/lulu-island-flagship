import Stripe from "stripe";
import { loadStripe, Stripe as StripeJS } from "@stripe/stripe-js";
import { logEvent } from "@/lib/observability";

// ── Server-side Stripe (Singleton, fail-fast) ──────────────────────────

const secretKey = process.env.STRIPE_SECRET_KEY;

let _stripeServer: Stripe | null = null;

/** Obtiene la instancia server-side de Stripe. Lanza error si no está configurada. */
export function getStripeServer(): Stripe {
  if (_stripeServer) return _stripeServer;
  if (!secretKey) {
    logEvent("stripe_secret_key_not_set", { module: "stripe" });
    throw new Error("Stripe no está configurado. Configurá STRIPE_SECRET_KEY en .env.local");
  }
  _stripeServer = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });
  return _stripeServer;
}

/** @deprecated Usar getStripeServer() — falla ruidosamente en vez de devolver null. */
export const stripe = secretKey
  ? new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" })
  : null;

/** @deprecated Usar getStripeServer() — falla ruidosamente en vez de devolver null. */
export function assertStripe(): Stripe {
  const s = getStripeServer();
  if (!s) throw new Error("Stripe no está configurado");
  return s;
}

// ── Client-side Stripe (lazy, Publishable Key) ─────────────────────────

let stripePromise: Promise<StripeJS | null> | null = null;

/** Obtiene Stripe.js para el navegador. Retorna null si NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY no está configurada. */
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

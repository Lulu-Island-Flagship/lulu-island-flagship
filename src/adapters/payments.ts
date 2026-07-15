/**
 * v8.3 E0.8 — Adaptador de pagos (anti-corruption layer).
 *
 * "Cada API externa (Stripe, PayPal, QBO, Twilio, Maps, firma) se consume a
 * través de un adaptador propio. Cambio del proveedor = tocar solo el
 * adaptador."
 *
 * DISEÑO SIN RIESGO: este archivo NO reescribe ni cambia el comportamiento
 * de `src/lib/stripe.ts` / `stripe-client.ts` / `paypal.ts` — ese código ya
 * corre en producción de dinero real y tocarlo directamente violaría la
 * regla de oro de E2 ("tests de contrato COMPLETOS antes del primer cobro
 * real"). Lo que hace es re-exportar esas mismas funciones bajo nombres de
 * negocio estables, para que:
 *
 *   - Código NUEVO importe siempre desde `@/adapters/payments`, nunca
 *     directo desde el SDK de Stripe/PayPal.
 *   - El día que cambie el proveedor de pagos, el cambio real ocurre en
 *     `src/lib/stripe.ts`/`paypal.ts` (que siguen siendo la implementación),
 *     y este archivo es el único lugar donde se actualiza qué se re-exporta.
 *
 * Migración de las rutas EXISTENTES que hoy importan `@/lib/stripe`
 * directamente (batch-capture, hold-authorize, no-show, etc.) queda como
 * trabajo incremental y deliberadamente NO se hizo en este pase -- son
 * rutas de dinero real ya probadas, y renombrar sus imports sin necesidad
 * es riesgo sin beneficio.
 */

export { stripe, assertStripe, getStripe as getStripeClientSide } from "@/lib/stripe";
export { getStripe as getStripeServerSide } from "@/lib/stripe-client";
export { verifyPayPalTransaction, type PayPalVerificationResult } from "@/lib/paypal";

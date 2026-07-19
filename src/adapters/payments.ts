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

import { verifyPayPalTransaction, type PayPalVerificationResult } from "@/lib/paypal";

/**
 * v8.3 E0 (auditoría 2026-07-18) — interfaz abstracta mínima + mock, SOLO
 * para PayPal (`verifyPayPalTransaction` ya tiene forma de entrada/salida
 * propia y estable, fácil de mockear).
 *
 * DEUDA TÉCNICA DOCUMENTADA (decisión consciente, no descuido): `stripe`,
 * `assertStripe`, `getStripeClientSide` y `getStripeServerSide` NO tienen
 * interfaz/mock propios en este pase. Son re-exports directos del cliente
 * oficial de Stripe (tipos del SDK `stripe`, cientos de métodos/objetos
 * anidados) y de un getter que devuelve ese mismo cliente ya inicializado.
 * Envolverlos en una interfaz mínima obligaría a elegir de antemano qué
 * subconjunto de la superficie de Stripe "cuenta", y ese subconjunto ya
 * cambia por endpoint (batch-capture, hold-authorize, no-show, etc. usan
 * métodos distintos de `stripe.paymentIntents`/`stripe.refunds`/etc.) --
 * hacerlo bien requeriría auditar cada caller primero, que es más trabajo
 * del que cabe en este pase de bugs de auditoría y no es lo que se pidió acá.
 * Los tests que hoy tocan Stripe ya lo resuelven mockeando el módulo
 * `src/lib/stripe.ts` completo (ver tests/lib/*.test.ts) en vez de a través
 * de este adaptador -- ese patrón se mantiene igual. Riesgo real: bajo (el
 * adaptador ya aísla el punto de import; falta la interfaz formal, no el
 * aislamiento).
 */
export interface PaymentsAdapter {
  verifyPayPalTransaction(
    transactionId: string,
    expectedAmount?: number
  ): Promise<PayPalVerificationResult>;
}

export const paymentsAdapter: PaymentsAdapter = { verifyPayPalTransaction };

export function createMockPaymentsAdapter(
  overrides?: Partial<PaymentsAdapter>
): PaymentsAdapter {
  return {
    verifyPayPalTransaction: async (transactionId: string, _expectedAmount?: number) => ({
      valid: true,
      transactionId,
      status: "COMPLETED",
      amount: 0,
      currency: "CAD",
    }),
    ...overrides,
  };
}

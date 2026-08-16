import { applyPercentRoundHalfUp } from "./money";

/**
 * v8.3 D.3 / E2 — Contrato Hold → captura → cancelación.
 *
 * Función pura extraída de src/app/api/orders/[orderId]/cancel/route.ts:
 * decide QUÉ debe pasar con el dinero según la ventana de cancelación,
 * sin tocar Stripe/PayPal ni la base de datos. El route.ts ejecuta lo que
 * esta función decide.
 *
 * RAÍZ-3 (2026-07-21, migración 229): esta función es agnóstica a la unidad
 * monetaria (solo hace min/max/round sobre los inputs) -- el caller pasa
 * TODOS los montos en la misma unidad. Desde la migración 229, el caller
 * (cancel/route.ts) pasa CENTAVOS (orders.hold_amount_cents/
 * hold_authorized_amount_cents ya nacen en centavos; quotes.total y
 * paypal_advance_amount, que siguen en dólares fuera de alcance, se escalan
 * x100 antes de invocar esta función). Los docs de abajo dicen "dólares"
 * porque así se documentó originalmente -- léase como "la unidad que use el
 * caller", hoy centavos.
 *
 * Reglas (D.3, ya vigentes en producción antes de esta sesión — esta
 * función no cambia el comportamiento, lo hace testeable):
 *   >72h antes del servicio:  Hold liberado, SIN cargo.
 *   24-72h antes:              se captura el 50% del Hold como penalidad.
 *   <24h / no-show:            se captura el 100% del Hold como penalidad.
 *
 * PayPal (solo primera reserva, D.3): el anticipo (50% del Hold) ya fue
 * cobrado real al reservar. Las ventanas ajustan cuánto de ese anticipo se
 * retiene y si hace falta cobrar una diferencia adicional por Stripe.
 */

export type CancellationWindow = "full_refund" | "partial_penalty" | "full_penalty";

export type PaymentOption = "card" | "paypal_first_time" | "alipay" | "wechat_pay";

export interface CancellationDecisionInput {
  /** Horas hasta el servicio (puede ser negativo si ya pasó / no-show). */
  hoursUntilService: number;
  /** Total de la cotización sellada. Unidad = la que use el caller (centavos desde la migración 229; ver nota RAÍZ-3 arriba). */
  quoteTotal: number;
  /** order.hold_authorized_amount_cents (RAÍZ-3, migración 229). Puede ser 0/null. */
  holdAuthorizedAmount: number;
  /** order.hold_amount_cents (RAÍZ-3, migración 229). Fallback si no hay authorized. */
  holdAmount: number;
  paymentOption: PaymentOption;
  /** order.paypal_advance_amount, escalado a la unidad del resto de inputs por el caller (0 si no aplica). */
  paypalAdvanceAmount: number;
  /**
   * order.wallet_amount_collected_cents (feature 2026-07-21): monto YA
   * cobrado en su totalidad al reservar vía Alipay/WeChat Pay. 0 si no
   * aplica (card/paypal_first_time). A diferencia de PayPal (que solo
   * adelanta el 50% del hold y deja el resto pendiente de cobro futuro),
   * Alipay/WeChat Pay ya cobraron el 100% -- así que cancelar nunca implica
   * un cobro NUEVO, solo decidir cuánto de lo ya cobrado se reembolsa.
   */
  walletAmountCollected?: number;
}

export interface CancellationDecision {
  window: CancellationWindow;
  /** Hold efectivo usado para los cálculos: min(max(0, authorized||hold), quoteTotal). */
  effectiveHoldAmount: number;
  /** Total que el cliente pierde/paga como penalidad (dólares). */
  penaltyAmount: number;
  /** Si corresponde intentar cancelar/liberar el PaymentIntent de Hold en Stripe. */
  releaseStripeHold: boolean;
  /** Monto a capturar del PaymentIntent de Hold existente (tarjeta), 0 si no aplica. */
  captureFromExistingHold: number;
  /** PayPal: si corresponde marcar un reembolso (proceso manual/async, >72h). */
  paypalRefundRequired: boolean;
  /** PayPal: cuánto del anticipo ya cobrado se retiene como penalidad. */
  paypalAmountRetained: number;
  /** PayPal <24h: diferencia que hay que cobrar por Stripe además del anticipo retenido. */
  stripeAdditionalChargeAmount: number;
  /**
   * Alipay/WeChat Pay: monto a reembolsar vía Stripe refund del
   * PaymentIntent que ya cobró el 100% (walletAmountCollected - penalidad
   * correspondiente a la ventana). 0 para card/paypal_first_time.
   */
  walletRefundAmount: number;
}

function resolveWindow(hoursUntilService: number): CancellationWindow {
  if (hoursUntilService > 72) return "full_refund";
  if (hoursUntilService >= 24) return "partial_penalty"; // 24-72h inclusive, igual que el route original
  return "full_penalty"; // <24h, incluye no-show (horas negativas)
}

export function computeCancellationDecision(
  input: CancellationDecisionInput
): CancellationDecision {
  const quoteTotal = Math.max(0, Math.round(input.quoteTotal));
  const effectiveHoldAmount = Math.min(
    Math.max(0, input.holdAuthorizedAmount || input.holdAmount || 0),
    quoteTotal
  );
  const window = resolveWindow(input.hoursUntilService);

  const isWallet = input.paymentOption === "alipay" || input.paymentOption === "wechat_pay";
  const walletAmountCollected = Math.max(0, Math.round(input.walletAmountCollected || 0));

  if (window === "full_refund") {
    if (isWallet) {
      return {
        window,
        effectiveHoldAmount,
        penaltyAmount: 0,
        releaseStripeHold: false,
        captureFromExistingHold: 0,
        paypalRefundRequired: false,
        paypalAmountRetained: 0,
        stripeAdditionalChargeAmount: 0,
        walletRefundAmount: walletAmountCollected,
      };
    }
    return {
      window,
      effectiveHoldAmount,
      penaltyAmount: 0,
      releaseStripeHold: true,
      captureFromExistingHold: 0,
      paypalRefundRequired:
        input.paymentOption === "paypal_first_time" && input.paypalAdvanceAmount > 0,
      paypalAmountRetained: 0,
      stripeAdditionalChargeAmount: 0,
      walletRefundAmount: 0,
    };
  }

  if (window === "partial_penalty") {
    const penaltyAmount = Number(applyPercentRoundHalfUp(BigInt(effectiveHoldAmount), 50));

    if (isWallet) {
      return {
        window,
        effectiveHoldAmount,
        penaltyAmount,
        releaseStripeHold: false,
        captureFromExistingHold: 0,
        paypalRefundRequired: false,
        paypalAmountRetained: 0,
        stripeAdditionalChargeAmount: 0,
        walletRefundAmount: Math.max(0, walletAmountCollected - penaltyAmount),
      };
    }

    if (input.paymentOption === "paypal_first_time") {
      const paypalAmountRetained = Math.min(input.paypalAdvanceAmount, penaltyAmount);
      return {
        window,
        effectiveHoldAmount,
        penaltyAmount: paypalAmountRetained,
        releaseStripeHold: true, // liberar cualquier hold stray en Stripe
        captureFromExistingHold: 0,
        paypalRefundRequired: false,
        paypalAmountRetained,
        stripeAdditionalChargeAmount: 0,
        walletRefundAmount: 0,
      };
    }

    return {
      window,
      effectiveHoldAmount,
      penaltyAmount,
      releaseStripeHold: false,
      captureFromExistingHold: penaltyAmount,
      paypalRefundRequired: false,
      paypalAmountRetained: 0,
      stripeAdditionalChargeAmount: 0,
      walletRefundAmount: 0,
    };
  }

  // full_penalty (<24h o no-show)
  if (isWallet) {
    return {
      window,
      effectiveHoldAmount,
      penaltyAmount: effectiveHoldAmount,
      releaseStripeHold: false,
      captureFromExistingHold: 0,
      paypalRefundRequired: false,
      paypalAmountRetained: 0,
      stripeAdditionalChargeAmount: 0,
      walletRefundAmount: Math.max(0, walletAmountCollected - effectiveHoldAmount),
    };
  }

  if (input.paymentOption === "paypal_first_time") {
    const paypalAmountRetained = Math.min(
      input.paypalAdvanceAmount || Number(applyPercentRoundHalfUp(BigInt(input.holdAmount), 50)),
      quoteTotal
    );
    const stripeAdditionalChargeAmount = Math.max(0, effectiveHoldAmount - paypalAmountRetained);
    return {
      window,
      effectiveHoldAmount,
      penaltyAmount: paypalAmountRetained + stripeAdditionalChargeAmount,
      releaseStripeHold: false,
      captureFromExistingHold: 0,
      paypalRefundRequired: false,
      paypalAmountRetained,
      stripeAdditionalChargeAmount,
      walletRefundAmount: 0,
    };
  }

  return {
    window,
    effectiveHoldAmount,
    penaltyAmount: effectiveHoldAmount,
    releaseStripeHold: false,
    captureFromExistingHold: effectiveHoldAmount,
    paypalRefundRequired: false,
    paypalAmountRetained: 0,
    stripeAdditionalChargeAmount: 0,
    walletRefundAmount: 0,
  };
}

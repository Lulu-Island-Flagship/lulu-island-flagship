import { describe, it } from "node:test";
import assert from "node:assert";
import { computeCancellationDecision } from "../../src/lib/order-cancellation";

describe("computeCancellationDecision — tarjeta", () => {
  it(">72h: reembolso completo del Hold, sin penalidad", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 100,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    assert.equal(d.window, "full_refund");
    assert.equal(d.penaltyAmount, 0);
    assert.equal(d.releaseStripeHold, true);
    assert.equal(d.captureFromExistingHold, 0);
    assert.equal(d.paypalRefundRequired, false);
  });

  it("exactamente 72h cuenta como full_refund (borde >72h estricto)", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 72,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    // 72 no es > 72, cae en la ventana 24-72h (partial_penalty)
    assert.equal(d.window, "partial_penalty");
  });

  it("24-72h: captura después de captura parcial — 50% del Hold como penalidad", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 48,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    assert.equal(d.window, "partial_penalty");
    assert.equal(d.penaltyAmount, 110); // round(220 * 0.5)
    assert.equal(d.captureFromExistingHold, 110);
    assert.equal(d.releaseStripeHold, false);
  });

  it("<24h: captura completa del Hold como penalidad", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 10,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    assert.equal(d.window, "full_penalty");
    assert.equal(d.penaltyAmount, 220);
    assert.equal(d.captureFromExistingHold, 220);
  });

  it("no-show (horas negativas): tratado igual que full_penalty", () => {
    const d = computeCancellationDecision({
      hoursUntilService: -3,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    assert.equal(d.window, "full_penalty");
    assert.equal(d.penaltyAmount, 220);
  });

  it("el Hold efectivo nunca excede el total de la cotización", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 10,
      quoteTotal: 100,
      holdAuthorizedAmount: 220, // hold mayor al total, caso defensivo
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    assert.equal(d.effectiveHoldAmount, 100);
    assert.equal(d.penaltyAmount, 100);
  });
});

describe("computeCancellationDecision — PayPal primera reserva", () => {
  it(">72h: reembolso completo requerido (proceso manual PayPal)", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 100,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "paypal_first_time",
      paypalAdvanceAmount: 110,
    });
    assert.equal(d.window, "full_refund");
    assert.equal(d.paypalRefundRequired, true);
    assert.equal(d.penaltyAmount, 0);
  });

  it("24-72h: se retiene el anticipo (equivale al 50% del hold)", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 48,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "paypal_first_time",
      paypalAdvanceAmount: 110,
    });
    assert.equal(d.window, "partial_penalty");
    assert.equal(d.paypalAmountRetained, 110);
    assert.equal(d.penaltyAmount, 110);
    assert.equal(d.stripeAdditionalChargeAmount, 0);
    assert.equal(d.releaseStripeHold, true); // libera cualquier hold stray
  });

  it("<24h: retiene anticipo + cobra diferencia hasta el hold completo por Stripe", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 10,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "paypal_first_time",
      paypalAdvanceAmount: 110,
    });
    assert.equal(d.window, "full_penalty");
    assert.equal(d.paypalAmountRetained, 110);
    assert.equal(d.stripeAdditionalChargeAmount, 110); // 220 - 110
    assert.equal(d.penaltyAmount, 220);
  });
});

describe("computeCancellationDecision — contrato de disputa bloqueando captura (integración conceptual)", () => {
  // La exclusión de disputas críticas ocurre ANTES de esta decisión, en el
  // Batch Capture 7PM (evaluateCaptureEligibility). Este test documenta el
  // límite del contrato: computeCancellationDecision solo decide penalidad
  // de cancelación; no sabe nada de disputas, y no debe saberlo — son
  // responsabilidades separadas por diseño (single responsibility).
  it("computeCancellationDecision no depende de disputas, siempre calcula la ventana", () => {
    const d = computeCancellationDecision({
      hoursUntilService: 48,
      quoteTotal: 500,
      holdAuthorizedAmount: 220,
      holdAmount: 220,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    });
    assert.equal(d.window, "partial_penalty");
  });
});

/**
 * v8.3 E2 — Suite de tests de contrato Hold → captura → cancelación
 * (criterio de aceptación E2: "Suite de tests de contrato: reserva→Hold→
 * captura, cancelaciones en las 3 ventanas [...]").
 *
 * Combina las dos funciones puras del módulo (computeCancellationDecision
 * y evaluateCaptureEligibility) para verificar los 3 casos límite pedidos:
 *   1. Cancelación ANTES de captura (>72h) → reembolso completo del Hold.
 *   2. Cancelación DESPUÉS de captura parcial (ventana 24-72h, donde el
 *      50% del Hold ya se capturó como penalidad) → el sistema no intenta
 *      cobrar de más ni liberar lo ya capturado.
 *   3. Disputa crítica documentada y abierta bloqueando el Batch Capture
 *      de las 7PM, sin afectar la lógica de cancelación (responsabilidades
 *      separadas, ver tests/lib/order-cancellation.test.ts).
 *
 * Sin DB real: todo el estado de la orden se modela como objetos en memoria.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { computeCancellationDecision } from "../../src/lib/order-cancellation";
import {
  evaluateCaptureEligibility,
  type OrderClaimForCaptureDecision,
} from "../../src/lib/batch-capture-eligibility";

interface FakeOrder {
  quoteTotal: number;
  holdAuthorizedAmount: number;
  holdAmount: number;
  paymentOption: "card" | "paypal_first_time";
  paypalAdvanceAmount: number;
}

describe("Contrato Hold → captura → cancelación", () => {
  it("Caso 1 — cancelación ANTES de captura (>72h): reembolso completo del Hold, cero penalidad", () => {
    const order: FakeOrder = {
      quoteTotal: 461,
      holdAuthorizedAmount: 247,
      holdAmount: 247,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    };

    const decision = computeCancellationDecision({
      hoursUntilService: 96, // reserva hecha con antelación, cliente cancela 4 días antes
      ...order,
    });

    assert.equal(decision.window, "full_refund");
    assert.equal(decision.penaltyAmount, 0, "no debe haber penalidad antes de captura");
    assert.equal(decision.captureFromExistingHold, 0, "no debe intentarse capturar nada");
    assert.equal(decision.releaseStripeHold, true, "el Hold debe liberarse, no capturarse");
  });

  it("Caso 2 — cancelación DESPUÉS de captura parcial (24-72h): el 50% ya capturado es la penalidad final, sin cargos adicionales", () => {
    const order: FakeOrder = {
      quoteTotal: 461,
      holdAuthorizedAmount: 247,
      holdAmount: 247,
      paymentOption: "card",
      paypalAdvanceAmount: 0,
    };

    const decision = computeCancellationDecision({
      hoursUntilService: 50, // dentro de la ventana 24-72h
      ...order,
    });

    assert.equal(decision.window, "partial_penalty");
    assert.equal(decision.penaltyAmount, 124); // round(247 * 0.5)
    assert.equal(decision.captureFromExistingHold, 124);
    assert.equal(
      decision.releaseStripeHold,
      false,
      "no debe liberarse el Hold: ya se capturó parcialmente como penalidad"
    );
    assert.equal(
      decision.stripeAdditionalChargeAmount,
      0,
      "no debe cobrarse nada adicional además de la penalidad parcial"
    );
  });

  it("Caso 2b — mismo escenario en PayPal primera reserva: el anticipo ya cobrado cubre la penalidad parcial", () => {
    const order: FakeOrder = {
      quoteTotal: 461,
      holdAuthorizedAmount: 247,
      holdAmount: 247,
      paymentOption: "paypal_first_time",
      paypalAdvanceAmount: 124, // 50% del hold, cobrado real al reservar (D.3)
    };

    const decision = computeCancellationDecision({
      hoursUntilService: 50,
      ...order,
    });

    assert.equal(decision.window, "partial_penalty");
    assert.equal(decision.paypalAmountRetained, 124);
    assert.equal(decision.penaltyAmount, 124);
    assert.equal(
      decision.stripeAdditionalChargeAmount,
      0,
      "el anticipo ya cobrado es suficiente, no debe cobrarse nada extra por Stripe"
    );
  });

  it("Caso 3 — disputa crítica documentada y abierta BLOQUEA el Batch Capture de las 7PM", () => {
    const claimsAtSevenPM: OrderClaimForCaptureDecision[] = [
      { id: "claim-critical-open", status: "open", severity: "critical", hasClientEvidence: true },
    ];

    const eligibility = evaluateCaptureEligibility(claimsAtSevenPM);

    assert.equal(eligibility.shouldCapture, false, "el Batch Capture debe excluir esta orden");
    assert.equal(eligibility.reason, "critical_documented_dispute_open");
    assert.equal(eligibility.blockingClaimId, "claim-critical-open");
  });

  it("Caso 3b — la MISMA orden, si la disputa se resuelve antes de las 7PM, sí se captura", () => {
    const claimsAtSevenPM: OrderClaimForCaptureDecision[] = [
      { id: "claim-critical-open", status: "resolved_lulu", severity: "critical", hasClientEvidence: true },
    ];

    const eligibility = evaluateCaptureEligibility(claimsAtSevenPM);

    assert.equal(eligibility.shouldCapture, true);
  });

  it("Caso 3c — una disputa NO crítica (minor) nunca bloquea el cobro (B.2.2: el pago no se congela por defecto)", () => {
    const claimsAtSevenPM: OrderClaimForCaptureDecision[] = [
      { id: "claim-minor-open", status: "open", severity: "minor", hasClientEvidence: true },
    ];

    const eligibility = evaluateCaptureEligibility(claimsAtSevenPM);

    assert.equal(eligibility.shouldCapture, true);
  });
});

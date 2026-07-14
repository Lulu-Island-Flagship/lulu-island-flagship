import { describe, it } from "node:test";
import assert from "node:assert";
import { computePartialCaptureDecision, REMAINDER_DELAY_HOURS } from "../../src/lib/batch-capture-partial";

const NOW = new Date("2026-07-13T19:00:00-07:00");

describe("computePartialCaptureDecision", () => {
  it("fuerza el total completo si el admin ya lo forzó, ignorando el costo laboral", () => {
    const result = computePartialCaptureDecision({
      quoteTotalCents: 50000,
      laborCostCents: 10000,
      forceFullCapture: true,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 50000);
    assert.equal(result.remainingCents, 0);
    assert.equal(result.remainingDueAt, null);
    assert.equal(result.reason, "forced_full_capture");
  });

  it("difiere TODO si no hay dato de costo laboral (nunca inventa un número)", () => {
    const result = computePartialCaptureDecision({
      quoteTotalCents: 50000,
      laborCostCents: null,
      forceFullCapture: false,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 0);
    assert.equal(result.remainingCents, 50000);
    assert.equal(result.reason, "labor_cost_unknown_defer_all");
    assert.equal(result.remainingDueAt, new Date(NOW.getTime() + REMAINDER_DELAY_HOURS * 3600 * 1000).toISOString());
  });

  it("captura el costo laboral + 10% ahora, difiere el resto a 24h", () => {
    // labor 20000, +10% = 22000; total 50000 -> resto 28000
    const result = computePartialCaptureDecision({
      quoteTotalCents: 50000,
      laborCostCents: 20000,
      forceFullCapture: false,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 22000);
    assert.equal(result.remainingCents, 28000);
    assert.equal(result.reason, "partial_labor_safe_capture");
    assert.notEqual(result.remainingDueAt, null);
  });

  it("respeta un buffer distinto al 10% default si se pasa explícito", () => {
    const result = computePartialCaptureDecision({
      quoteTotalCents: 50000,
      laborCostCents: 20000,
      laborBufferRatio: 0.25,
      forceFullCapture: false,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 25000); // 20000 * 1.25
  });

  it("nunca captura más que el total de la cotización aunque el costo laboral+buffer lo supere", () => {
    const result = computePartialCaptureDecision({
      quoteTotalCents: 30000,
      laborCostCents: 35000, // 35000*1.1=38500 > 30000
      forceFullCapture: false,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 30000);
    assert.equal(result.remainingCents, 0);
    assert.equal(result.remainingDueAt, null);
    assert.equal(result.reason, "labor_cost_covers_full_total");
  });

  it("quoteTotal <= 0 no captura ni difiere nada", () => {
    const result = computePartialCaptureDecision({
      quoteTotalCents: 0,
      laborCostCents: 1000,
      forceFullCapture: false,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 0);
    assert.equal(result.remainingCents, 0);
    assert.equal(result.remainingDueAt, null);
  });

  it("labor cost 0 (ej. rework/penalización dejó el bruto en 0) igual respeta el buffer sobre 0 -> captura 0 ahora, difiere todo", () => {
    const result = computePartialCaptureDecision({
      quoteTotalCents: 50000,
      laborCostCents: 0,
      forceFullCapture: false,
      now: NOW,
    });
    assert.equal(result.captureNowCents, 0);
    assert.equal(result.remainingCents, 50000);
    assert.equal(result.reason, "partial_labor_safe_capture");
  });
});

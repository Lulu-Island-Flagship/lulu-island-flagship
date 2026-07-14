import { describe, it } from "node:test";
import assert from "node:assert";
import {
  semaphoreForMinThreshold,
  computeDisputeFreeRatePercent,
  computeBatchCaptureSuccessRatePercent,
  computeNetMargin,
  DASHBOARD_THRESHOLDS,
} from "../../src/lib/dashboard-metrics";

describe("semaphoreForMinThreshold", () => {
  it("green si value >= threshold", () => {
    assert.equal(semaphoreForMinThreshold(96, 95), "green");
    assert.equal(semaphoreForMinThreshold(95, 95), "green");
  });

  it("yellow entre 90% y 100% del threshold", () => {
    assert.equal(semaphoreForMinThreshold(90, 95), "yellow"); // 90/95 = 0.947
  });

  it("red por debajo del 90% del threshold", () => {
    assert.equal(semaphoreForMinThreshold(80, 95), "red"); // 80/95 = 0.84
  });

  it("unknown si el valor es null/undefined/NaN", () => {
    assert.equal(semaphoreForMinThreshold(null, 95), "unknown");
    assert.equal(semaphoreForMinThreshold(undefined, 95), "unknown");
    assert.equal(semaphoreForMinThreshold(NaN, 95), "unknown");
  });
});

describe("computeDisputeFreeRatePercent", () => {
  it("100% si no hay disputas", () => {
    assert.equal(computeDisputeFreeRatePercent({ completedServicesCount: 50, servicesWithDisputeCount: 0 }), 100);
  });

  it("calcula el porcentaje correctamente", () => {
    assert.equal(computeDisputeFreeRatePercent({ completedServicesCount: 100, servicesWithDisputeCount: 5 }), 95);
  });

  it("null si no hay servicios completados (evita división por cero)", () => {
    assert.equal(computeDisputeFreeRatePercent({ completedServicesCount: 0, servicesWithDisputeCount: 0 }), null);
  });
});

describe("computeBatchCaptureSuccessRatePercent", () => {
  it("calcula el porcentaje de éxito", () => {
    assert.equal(
      computeBatchCaptureSuccessRatePercent({ successfulCaptureCount: 98, failedCaptureCount: 2 }),
      98
    );
  });

  it("null si no hubo ningún intento", () => {
    assert.equal(
      computeBatchCaptureSuccessRatePercent({ successfulCaptureCount: 0, failedCaptureCount: 0 }),
      null
    );
  });
});

describe("computeNetMargin", () => {
  it("null si los costos fijos nunca se configuraron", () => {
    const result = computeNetMargin({
      avgContributionMarginPercent: 30,
      avgOrderValueDollars: 300,
      monthlyFixedCostsCents: 0,
      servicesCountThisMonth: 40,
      fixedCostsConfigured: false,
    });
    assert.equal(result.netMarginPercent, null);
    assert.equal(result.fixedCostPerServiceDollars, null);
  });

  it("resta el costo fijo prorrateado del margen de contribución", () => {
    // $5000/mes de costos fijos, 40 servicios, orden promedio $300, contribución 30%
    // costo fijo/servicio = 5000/40 = $125
    // contribución $/orden = 0.30 * 300 = $90
    // neto $/orden = 90 - 125 = -$35 -> -11.67%
    const result = computeNetMargin({
      avgContributionMarginPercent: 30,
      avgOrderValueDollars: 300,
      monthlyFixedCostsCents: 500000,
      servicesCountThisMonth: 40,
      fixedCostsConfigured: true,
    });
    assert.equal(result.fixedCostPerServiceDollars, 125);
    assert.equal(result.netMarginPercent, -11.67);
  });

  it("neto positivo cuando la contribución cubre de sobra el costo fijo", () => {
    // costo fijo/servicio = 2000/50 = $40; contribución $/orden = 0.35*300=$105; neto=$65 -> 21.67%
    const result = computeNetMargin({
      avgContributionMarginPercent: 35,
      avgOrderValueDollars: 300,
      monthlyFixedCostsCents: 200000,
      servicesCountThisMonth: 50,
      fixedCostsConfigured: true,
    });
    assert.equal(result.fixedCostPerServiceDollars, 40);
    assert.equal(result.netMarginPercent, 21.67);
  });

  it("null si no hubo servicios este mes (evita división por cero)", () => {
    const result = computeNetMargin({
      avgContributionMarginPercent: 30,
      avgOrderValueDollars: 300,
      monthlyFixedCostsCents: 500000,
      servicesCountThisMonth: 0,
      fixedCostsConfigured: true,
    });
    assert.equal(result.netMarginPercent, null);
  });
});

describe("DASHBOARD_THRESHOLDS", () => {
  it("coincide literalmente con los umbrales de D.13", () => {
    assert.equal(DASHBOARD_THRESHOLDS.disputeFreeRatePercent, 95);
    assert.equal(DASHBOARD_THRESHOLDS.batchCaptureSuccessRatePercent, 98);
    assert.equal(DASHBOARD_THRESHOLDS.teamScoreAverage, 75);
    assert.equal(DASHBOARD_THRESHOLDS.contributionMarginPercent, 25);
  });
});

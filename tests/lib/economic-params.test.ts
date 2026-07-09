import { describe, it } from "node:test";
import assert from "node:assert";
import {
  calculateMinimumWageImpact,
  listAffectedContracts,
  isLegalFeedBlind,
} from "../../src/lib/economic-params";

describe("calculateMinimumWageImpact", () => {
  it("detecta cambio y calcula delta correctamente", () => {
    const r = calculateMinimumWageImpact({
      currentMinimumWage: 17.85,
      newMinimumWage: 18.65,
      currentMinimumDayRate: 142.8,
      standardDayHours: 8,
    });
    assert.equal(r.changed, true);
    assert.ok(Math.abs(r.deltaPerHour - 0.8) < 0.001);
  });

  it("sin cambio real, changed=false", () => {
    const r = calculateMinimumWageImpact({
      currentMinimumWage: 17.85,
      newMinimumWage: 17.85,
      currentMinimumDayRate: 142.8,
      standardDayHours: 8,
    });
    assert.equal(r.changed, false);
  });

  it("el Day Rate sugerido nunca queda bajo el piso legal (salario x horas)", () => {
    const r = calculateMinimumWageImpact({
      currentMinimumWage: 17.85,
      newMinimumWage: 20,
      currentMinimumDayRate: 142.8,
      standardDayHours: 8,
    });
    assert.equal(r.suggestedMinimumDayRate, 160); // 20 * 8
  });

  it("si el Day Rate actual ya supera el nuevo piso legal, no lo baja", () => {
    const r = calculateMinimumWageImpact({
      currentMinimumWage: 17.85,
      newMinimumWage: 18,
      currentMinimumDayRate: 200, // ya muy por encima
      standardDayHours: 8,
    });
    assert.equal(r.suggestedMinimumDayRate, 200);
    assert.equal(r.dayRateDeltaDollars, 0);
  });
});

describe("listAffectedContracts", () => {
  it("marca solo los contratos bajo el nuevo piso", () => {
    const contracts = [
      { contractId: "a", currentDayRate: 140 },
      { contractId: "b", currentDayRate: 170 },
    ];
    const result = listAffectedContracts(contracts, 160);
    assert.equal(result.find((c) => c.contractId === "a")!.needsAdjustment, true);
    assert.equal(result.find((c) => c.contractId === "b")!.needsAdjustment, false);
  });
});

describe("isLegalFeedBlind", () => {
  it("antes de 30 dias, no esta ciego", () => {
    assert.equal(isLegalFeedBlind("2026-07-01T00:00:00Z", "2026-07-20T00:00:00Z"), false);
  });
  it("30+ dias sin actualizar, esta ciego", () => {
    assert.equal(isLegalFeedBlind("2026-06-01T00:00:00Z", "2026-07-05T00:00:00Z"), true);
  });
});

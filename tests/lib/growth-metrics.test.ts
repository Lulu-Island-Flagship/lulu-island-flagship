import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeNpsScore,
  evaluateFunnelConversionRate,
  evaluateReferralRate,
  evaluateChurnRate,
  meetsNpsTarget,
} from "../../src/lib/growth-metrics";

describe("computeNpsScore", () => {
  it("0 respuestas = 0", () => {
    const r = computeNpsScore([]);
    assert.equal(r.npsScore, 0);
    assert.equal(r.totalResponses, 0);
  });

  it("todos promotores = 100", () => {
    const r = computeNpsScore([{ score: 9 }, { score: 10 }, { score: 9 }]);
    assert.equal(r.npsScore, 100);
    assert.equal(r.promoters, 3);
  });

  it("todos detractores = -100", () => {
    const r = computeNpsScore([{ score: 0 }, { score: 5 }, { score: 6 }]);
    assert.equal(r.npsScore, -100);
    assert.equal(r.detractors, 3);
  });

  it("mezcla: 50 promotores, 0 pasivos, 20 detractores de 100", () => {
    const responses = [
      ...Array(50).fill({ score: 9 }),
      ...Array(30).fill({ score: 7 }),
      ...Array(20).fill({ score: 3 }),
    ];
    const r = computeNpsScore(responses);
    // (50-20)/100 * 100 = 30
    assert.equal(r.npsScore, 30);
    assert.equal(r.promoters, 50);
    assert.equal(r.passives, 30);
    assert.equal(r.detractors, 20);
  });
});

describe("evaluateFunnelConversionRate", () => {
  it("0 cotizaciones = below_target", () => {
    const r = evaluateFunnelConversionRate(0, 0);
    assert.equal(r.stage, "below_target");
  });

  it("10% = below_target", () => {
    const r = evaluateFunnelConversionRate(100, 10);
    assert.equal(r.stage, "below_target");
  });

  it("20% = acceptable", () => {
    const r = evaluateFunnelConversionRate(100, 20);
    assert.equal(r.stage, "acceptable");
  });

  it("30% = excellent", () => {
    const r = evaluateFunnelConversionRate(100, 30);
    assert.equal(r.stage, "excellent");
  });
});

describe("evaluateReferralRate", () => {
  it("25% cumple meta (>20%)", () => {
    const r = evaluateReferralRate(100, 25);
    assert.equal(r.meetsTarget, true);
  });

  it("20% exacto NO cumple (estrictamente mayor)", () => {
    const r = evaluateReferralRate(100, 20);
    assert.equal(r.meetsTarget, false);
  });
});

describe("evaluateChurnRate", () => {
  it("5% cumple meta (<10%)", () => {
    const r = evaluateChurnRate(100, 5);
    assert.equal(r.meetsTarget, true);
  });

  it("10% exacto NO cumple (estrictamente menor)", () => {
    const r = evaluateChurnRate(100, 10);
    assert.equal(r.meetsTarget, false);
  });

  it("0 clientes activos = meets target trivialmente", () => {
    const r = evaluateChurnRate(0, 0);
    assert.equal(r.meetsTarget, true);
  });
});

describe("meetsNpsTarget", () => {
  it("51 cumple (>50)", () => {
    assert.equal(meetsNpsTarget(51), true);
  });
  it("50 exacto no cumple", () => {
    assert.equal(meetsNpsTarget(50), false);
  });
});

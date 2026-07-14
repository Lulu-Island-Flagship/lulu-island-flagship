import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateSeniorEligibility,
  evaluateManualOnlyLevel,
  nextCareerLevel,
  CAREER_LEVEL_ORDER,
} from "../../src/lib/career-path";

describe("evaluateSeniorEligibility", () => {
  it("elegible cuando los 3 checks pasan", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 6,
      certificationLevel2Verified: true,
      sustainedScoreAverage: 75,
    });
    assert.equal(result.eligible, true);
    assert.equal(result.checks.tenure, true);
    assert.equal(result.checks.certificationLevel2, true);
    assert.equal(result.checks.sustainedScore, true);
  });

  it("no elegible si falta tenure aunque el resto pase", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 3,
      certificationLevel2Verified: true,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.checks.tenure, false);
  });

  it("no elegible si el admin no ha verificado la certificación", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationLevel2Verified: false,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.eligible, false);
  });

  it("siempre reporta la certificación como no verificable por el sistema", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationLevel2Verified: true,
      sustainedScoreAverage: 90,
    });
    assert.ok(result.unverifiableBySystem.length > 0);
  });
});

describe("evaluateManualOnlyLevel", () => {
  it("nunca es elegible automáticamente (siempre eligible=false)", () => {
    assert.equal(evaluateManualOnlyLevel("lider").eligible, false);
    assert.equal(evaluateManualOnlyLevel("lider_mentor").eligible, false);
    assert.equal(evaluateManualOnlyLevel("coordinador_operativo").eligible, false);
  });

  it("lista los requisitos no verificables para cada nivel", () => {
    assert.ok(evaluateManualOnlyLevel("lider").unverifiableBySystem.length >= 3);
    assert.ok(evaluateManualOnlyLevel("coordinador_operativo").unverifiableBySystem.length >= 2);
  });
});

describe("nextCareerLevel", () => {
  it("avanza en el orden correcto", () => {
    assert.equal(nextCareerLevel("trabajador"), "senior");
    assert.equal(nextCareerLevel("senior"), "lider");
    assert.equal(nextCareerLevel("lider"), "lider_mentor");
    assert.equal(nextCareerLevel("lider_mentor"), "coordinador_operativo");
  });

  it("null en el último nivel", () => {
    assert.equal(nextCareerLevel("coordinador_operativo"), null);
  });

  it("CAREER_LEVEL_ORDER tiene los 5 niveles del spec", () => {
    assert.equal(CAREER_LEVEL_ORDER.length, 5);
  });
});

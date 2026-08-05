import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateSeniorEligibility,
  evaluateManualOnlyLevel,
  nextCareerLevel,
  CAREER_LEVEL_ORDER,
} from "../../src/lib/career-path";

const TODAY = "2026-07-14";

describe("evaluateSeniorEligibility", () => {
  it("elegible cuando los 3 checks pasan (certificación real vigente nivel 2)", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 6,
      certificationRecords: [
        { level: 2, expiresAtISO: "2027-01-01", revokedAtISO: null },
      ],
      todayISO: TODAY,
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
      certificationRecords: [
        { level: 2, expiresAtISO: "2027-01-01", revokedAtISO: null },
      ],
      todayISO: TODAY,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.checks.tenure, false);
  });

  it("no elegible si no hay ningún registro de certificación", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationRecords: [],
      todayISO: TODAY,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.checks.certificationLevel2, false);
  });

  it("no elegible si la única certificación nivel 2 está vencida", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationRecords: [
        { level: 2, expiresAtISO: "2020-01-01", revokedAtISO: null },
      ],
      todayISO: TODAY,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.checks.certificationLevel2, false);
  });

  it("no elegible si la certificación nivel 2 fue revocada", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationRecords: [
        { level: 2, expiresAtISO: "2027-01-01", revokedAtISO: "2026-01-01" },
      ],
      todayISO: TODAY,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.eligible, false);
  });

  it("elegible con certificación nivel 3 vigente (satisface el mínimo nivel 2)", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationRecords: [
        { level: 3, expiresAtISO: "2027-01-01", revokedAtISO: null },
      ],
      todayISO: TODAY,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.checks.certificationLevel2, true);
  });

  it("ya no reporta ningún check como no verificable por el sistema", () => {
    const result = evaluateSeniorEligibility({
      tenureMonths: 12,
      certificationRecords: [
        { level: 2, expiresAtISO: "2027-01-01", revokedAtISO: null },
      ],
      todayISO: TODAY,
      sustainedScoreAverage: 90,
    });
    assert.equal(result.unverifiableBySystem.length, 0);
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
    assert.equal(CAREER_LEVEL_ORDER.length, 6);
  });
});

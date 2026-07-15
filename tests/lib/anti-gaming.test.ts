import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isQcSampleSelected,
  evaluateSampledRejectionRate,
  decideGamingConsequence,
  QC_SAMPLING_RATE,
  GAMING_REJECTION_THRESHOLD,
  RETROACTIVE_REVIEW_COUNT,
} from "../../src/lib/anti-gaming";

describe("isQcSampleSelected", () => {
  it("es determinístico: mismo orderId+fecha siempre da el mismo resultado", () => {
    const a = isQcSampleSelected("order-123", "2026-07-14");
    const b = isQcSampleSelected("order-123", "2026-07-14");
    assert.equal(a, b);
  });

  it("cambia la muestra día a día para el mismo orderId", () => {
    const results = new Set<boolean>();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      results.add(isQcSampleSelected("order-fixed", date));
    }
    // con 30 días distintos, se espera que no salga siempre el mismo lado
    assert.ok(results.size > 1, "la selección debería variar con la fecha");
  });

  it("rate=0 nunca selecciona, rate=1 siempre selecciona", () => {
    assert.equal(isQcSampleSelected("order-x", "2026-07-14", 0), false);
    assert.equal(isQcSampleSelected("order-x", "2026-07-14", 1), true);
  });

  it("la proporción real se acerca al 10% en una muestra grande", () => {
    let selected = 0;
    const total = 5000;
    for (let i = 0; i < total; i++) {
      if (isQcSampleSelected(`order-${i}`, "2026-07-14")) selected++;
    }
    const ratio = selected / total;
    assert.ok(Math.abs(ratio - QC_SAMPLING_RATE) < 0.03, `ratio ${ratio} debería acercarse a ${QC_SAMPLING_RATE}`);
  });
});

describe("evaluateSampledRejectionRate", () => {
  it("sin muestra, no hay evidencia de manipulación", () => {
    const r = evaluateSampledRejectionRate([]);
    assert.equal(r.exceedsThreshold, false);
    assert.equal(r.sampleSize, 0);
  });

  it("no excede el umbral con 15% exacto de rechazo", () => {
    const sample = [
      ...Array(17).fill({ status: "approved" as const }),
      ...Array(3).fill({ status: "rejected" as const }),
    ]; // 3/20 = 15%
    const r = evaluateSampledRejectionRate(sample);
    assert.equal(r.rejectionRate, 0.15);
    assert.equal(r.exceedsThreshold, false);
    assert.equal(GAMING_REJECTION_THRESHOLD, 0.15);
  });

  it("excede el umbral por encima de 15%", () => {
    const sample = [
      ...Array(16).fill({ status: "approved" as const }),
      ...Array(4).fill({ status: "rejected" as const }),
    ]; // 4/20 = 20%
    const r = evaluateSampledRejectionRate(sample);
    assert.equal(r.exceedsThreshold, true);
  });
});

describe("decideGamingConsequence", () => {
  it("primera detección revoca auto-aprobación y exige revisión retroactiva de 10", () => {
    const c = decideGamingConsequence(0);
    assert.equal(c.action, "auto_approval_revoked");
    assert.equal(c.detectionNumber, 1);
    assert.equal(c.retroactiveReviewCount, RETROACTIVE_REVIEW_COUNT);
  });

  it("segunda detección suspende", () => {
    const c = decideGamingConsequence(1);
    assert.equal(c.action, "suspended");
    assert.equal(c.detectionNumber, 2);
  });

  it("detecciones subsecuentes también suspenden", () => {
    const c = decideGamingConsequence(5);
    assert.equal(c.action, "suspended");
    assert.equal(c.detectionNumber, 6);
  });
});

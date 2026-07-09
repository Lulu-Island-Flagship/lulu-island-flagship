import { describe, it } from "node:test";
import assert from "node:assert";
import { detectChurnSignal } from "../../src/lib/churn-detection";

describe("detectChurnSignal", () => {
  it("cancelacion + mencion de competidor => intervencion personal (prioridad maxima)", () => {
    const r = detectChurnSignal({
      pattern: "recurring",
      daysSinceLastService: 100,
      cancelledWithCompetitorMention: true,
    });
    assert.equal(r.action, "personal_intervention");
  });

  it("score de equipo cae de >70 a <40 => flag disputa no reportada", () => {
    const r = detectChurnSignal({
      pattern: "recurring",
      daysSinceLastService: 5,
      cancelledWithCompetitorMention: false,
      teamScoreTrend: { previous: 80, current: 30 },
    });
    assert.equal(r.action, "flag_unreported_dispute");
  });

  it("caida de score que NO cruza el umbral no dispara nada", () => {
    const r = detectChurnSignal({
      pattern: "recurring",
      daysSinceLastService: 5,
      cancelledWithCompetitorMention: false,
      teamScoreTrend: { previous: 65, current: 50 },
    });
    assert.equal(r.action, "none");
  });

  it("recurrente 60+ dias sin servicio => encuesta $20", () => {
    const r = detectChurnSignal({
      pattern: "recurring",
      daysSinceLastService: 60,
      cancelledWithCompetitorMention: false,
    });
    assert.equal(r.action, "survey_20");
  });

  it("recurrente con menos de 60 dias no dispara nada", () => {
    const r = detectChurnSignal({
      pattern: "recurring",
      daysSinceLastService: 45,
      cancelledWithCompetitorMention: false,
    });
    assert.equal(r.action, "none");
  });

  it("esporadico 90+ dias sin servicio => 30% off", () => {
    const r = detectChurnSignal({
      pattern: "sporadic",
      daysSinceLastService: 95,
      cancelledWithCompetitorMention: false,
    });
    assert.equal(r.action, "discount_30_percent");
  });

  it("esporadico 60 dias (bajo el umbral de 90) no dispara nada", () => {
    const r = detectChurnSignal({
      pattern: "sporadic",
      daysSinceLastService: 60,
      cancelledWithCompetitorMention: false,
    });
    assert.equal(r.action, "none");
  });
});

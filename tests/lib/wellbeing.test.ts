/**
 * v8.3 E8 — Tests de reglas de bienestar.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isChemicalAlertTimerExpired,
  shouldTriggerChemicalWellbeingAlert,
  evaluateReadinessRequest,
  detectAbusePattern,
  shouldSuggestTeamCheckin,
} from "../../src/lib/wellbeing";

describe("shouldTriggerChemicalWellbeingAlert", () => {
  it("sin tarea de riesgo quimico hoy, nunca dispara alerta", () => {
    assert.equal(shouldTriggerChemicalWellbeingAlert("sad", false, false), false);
  });
  it("mal animo + tarea de riesgo quimico => dispara alerta", () => {
    assert.equal(shouldTriggerChemicalWellbeingAlert("sad", null, true), true);
  });
  it("durmio mal + tarea de riesgo quimico => dispara alerta", () => {
    assert.equal(shouldTriggerChemicalWellbeingAlert(null, false, true), true);
  });
  it("buen estado + tarea de riesgo quimico => NO dispara", () => {
    assert.equal(shouldTriggerChemicalWellbeingAlert("happy", true, true), false);
  });
});

describe("isChemicalAlertTimerExpired", () => {
  it("antes de 10 min, no expira", () => {
    assert.equal(
      isChemicalAlertTimerExpired("2026-07-09T10:00:00Z", "2026-07-09T10:05:00Z", null),
      false
    );
  });
  it("a los 10+ min sin respuesta, expira (reasignacion automatica)", () => {
    assert.equal(
      isChemicalAlertTimerExpired("2026-07-09T10:00:00Z", "2026-07-09T10:11:00Z", null),
      true
    );
  });
  it("si el admin ya respondio, nunca expira sin importar el tiempo", () => {
    assert.equal(
      isChemicalAlertTimerExpired("2026-07-09T10:00:00Z", "2026-07-09T11:00:00Z", "2026-07-09T10:02:00Z"),
      false
    );
  });
});

describe("evaluateReadinessRequest", () => {
  it("enfermedad avisada >=2h => Day Rate completo", () => {
    const r = evaluateReadinessRequest("illness", 3);
    assert.equal(r.fullDayRate, true);
  });
  it("enfermedad avisada <2h => NO Day Rate completo", () => {
    const r = evaluateReadinessRequest("illness", 1);
    assert.equal(r.fullDayRate, false);
  });
  it("emergencia familiar 1ra vez en el trimestre => Day Rate completo", () => {
    const r = evaluateReadinessRequest("family_emergency", 0, 0);
    assert.equal(r.fullDayRate, true);
  });
  it("emergencia familiar YA usada este trimestre => NO Day Rate", () => {
    const r = evaluateReadinessRequest("family_emergency", 0, 1);
    assert.equal(r.fullDayRate, false);
  });
  it("sin transporte nunca otorga Day Rate automatico", () => {
    const r = evaluateReadinessRequest("no_transport", 5);
    assert.equal(r.fullDayRate, false);
  });
});

describe("detectAbusePattern", () => {
  it("3 o menos solicitudes en el trimestre no excede el limite", () => {
    const r = detectAbusePattern(["2026-07-01", "2026-07-08", "2026-07-15"]);
    assert.equal(r.exceedsQuarterLimit, false);
  });
  it("4+ solicitudes excede el limite de 3/trimestre", () => {
    const r = detectAbusePattern(["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"]);
    assert.equal(r.exceedsQuarterLimit, true);
  });
  it("2+ solicitudes cayendo en viernes o lunes => patron detectado", () => {
    // 2026-07-03 es viernes, 2026-07-06 es lunes
    const r = detectAbusePattern(["2026-07-03", "2026-07-06"]);
    assert.equal(r.fridayMondayPattern, true);
  });
  it("solicitudes entre semana no generan patron viernes/lunes", () => {
    // 2026-07-07 martes, 2026-07-08 miercoles
    const r = detectAbusePattern(["2026-07-07", "2026-07-08"]);
    assert.equal(r.fridayMondayPattern, false);
  });
});

describe("shouldSuggestTeamCheckin", () => {
  const day = (neutralOrSad: number, total: number, date = "2026-07-01"): { date: string; neutralOrSadCount: number; totalCount: number } => ({
    date, neutralOrSadCount: neutralOrSad, totalCount: total,
  });

  it("5 dias con mayoria de animo bajo => sugiere check-in", () => {
    const days = [day(3, 5), day(4, 5), day(3, 4), day(5, 5), day(3, 5)];
    assert.equal(shouldSuggestTeamCheckin(days), true);
  });

  it("menos de 5 dias de animo bajo => no sugiere todavia", () => {
    const days = [day(3, 5), day(4, 5), day(3, 4)];
    assert.equal(shouldSuggestTeamCheckin(days), false);
  });

  it("dias con mayoria de animo alto no cuentan para el umbral", () => {
    const days = [day(1, 5), day(1, 5), day(1, 5), day(1, 5), day(1, 5)];
    assert.equal(shouldSuggestTeamCheckin(days), false);
  });
});

/**
 * v8.3 E3 (D.4, E2#9) — Tests del umbral "equipo #6" de auto-aprobación en
 * la fase de revisión/override del ciclo diario de despacho.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateTeamSixAutoApproval, TEAM_SIX_AUTO_APPROVAL_THRESHOLD } from "../../src/lib/dispatch-approval";

describe("evaluateTeamSixAutoApproval — umbral equipo #6", () => {
  it("con menos de 6 equipos disponibles, no se activa el umbral", () => {
    const r = evaluateTeamSixAutoApproval(5, false);
    assert.equal(r.teamSixActive, false);
    assert.equal(r.autoApproveDefault, false);
    assert.equal(r.showDelegationReminder, false);
  });

  it("con exactamente 6 equipos disponibles y sin alertas rojas, auto-aprueba por default", () => {
    const r = evaluateTeamSixAutoApproval(6, false);
    assert.equal(r.teamSixActive, true);
    assert.equal(r.autoApproveDefault, true);
    assert.equal(r.showDelegationReminder, true);
  });

  it("con 6+ equipos pero CON alertas rojas, NO auto-aprueba (salvo alertas rojas del plan)", () => {
    const r = evaluateTeamSixAutoApproval(6, true);
    assert.equal(r.teamSixActive, true);
    assert.equal(r.autoApproveDefault, false);
  });

  it("el recordatorio de delegación aparece aunque haya alertas rojas (E2#9 no depende de alertas)", () => {
    const r = evaluateTeamSixAutoApproval(9, true);
    assert.equal(r.showDelegationReminder, true);
    assert.equal(r.autoApproveDefault, false);
  });

  it("con más de 6 equipos disponibles, el umbral sigue activo", () => {
    const r = evaluateTeamSixAutoApproval(12, false);
    assert.equal(r.teamSixActive, true);
    assert.equal(r.autoApproveDefault, true);
  });

  it("el umbral por default es 6 (constante exportada, coincide con el plan)", () => {
    assert.equal(TEAM_SIX_AUTO_APPROVAL_THRESHOLD, 6);
  });

  it("umbral configurable para tests no afecta el default de producción", () => {
    const r = evaluateTeamSixAutoApproval(3, false, 3);
    assert.equal(r.teamSixActive, true);
    assert.equal(r.autoApproveDefault, true);
  });
});

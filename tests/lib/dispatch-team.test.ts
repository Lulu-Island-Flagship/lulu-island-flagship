/**
 * v8.3 E3 — Tests de las reglas duras de formación de equipo:
 * líder obligatorio (M0-F0.5) y match de idioma (invariante B.2.13).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildTeam,
  enforceMaxTeamSize,
  B2C_RESIDENTIAL_N_MAX,
  type DispatchCandidate,
} from "../../src/lib/dispatch-team";

const cleaner = (id: string, langs: string[], zone = "Richmond"): DispatchCandidate => ({
  id, role: "cleaner", languages: langs, homeZone: zone, trustLevel: "standard",
});
const leader = (id: string, langs: string[], zone = "Richmond"): DispatchCandidate => ({
  id, role: "supervisor", languages: langs, homeZone: zone, trustLevel: "standard",
});

describe("buildTeam — reglas duras E3", () => {
  it("sin supervisor disponible NO hay equipo (líder obligatorio)", () => {
    const r = buildTeam([cleaner("c1", ["en"]), cleaner("c2", ["en"])], ["en"], 2, "Richmond");
    assert.equal(r.team, null);
    assert.equal(r.pendingReason, "no_leader_available");
  });

  it("líder sin idioma de la cuenta => NO se asigna (queda pendiente al admin)", () => {
    const r = buildTeam([leader("l1", ["en"]), cleaner("c1", ["zh"])], ["zh"], 2, "Richmond");
    assert.equal(r.team, null);
    assert.equal(r.pendingReason, "no_language_match");
  });

  it("match parcial genera warning para el admin (sugiere, no bloquea al humano)", () => {
    const r = buildTeam([leader("l1", ["en"]), cleaner("c1", ["zh"])], ["zh"], 2, "Richmond");
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /Match parcial/);
  });

  it("líder con match lidera el equipo; miembros que hablan el idioma van primero", () => {
    const r = buildTeam(
      [cleaner("c_en", ["en"]), leader("l_zh", ["zh", "en"]), cleaner("c_zh", ["zh"])],
      ["zh"],
      3,
      "Richmond"
    );
    assert.notEqual(r.team, null);
    assert.equal(r.leaderId, "l_zh");
    assert.equal(r.team![1].id, "c_zh"); // el que habla zh entra antes que el que no
  });

  it("prioriza idiomas de la cuenta en orden (múltiples idiomas)", () => {
    const r = buildTeam([leader("l1", ["es"]), cleaner("c1", ["en"])], ["zh", "es"], 2, "Richmond");
    assert.notEqual(r.team, null); // es está en la lista de la cuenta
    assert.equal(r.leaderId, "l1");
  });

  it("cuenta sin idiomas registrados usa 'en' por defecto", () => {
    const r = buildTeam([leader("l1", ["en"])], [], 1, "Richmond");
    assert.notEqual(r.team, null);
  });

  it("equipo incompleto se arma igual pero con warning", () => {
    const r = buildTeam([leader("l1", ["en"])], ["en"], 3, "Richmond");
    assert.equal(r.team!.length, 1);
    assert.match(r.warnings[0], /incompleto/);
  });
});

describe("enforceMaxTeamSize — invariante B.2.1 (N_max)", () => {
  it("4 personas en B2C residencial se rechaza, SIEMPRE", () => {
    const r = enforceMaxTeamSize("b2c_residential", 4, false);
    assert.equal(r.valid, false);
    assert.equal(r.correctedSize, B2C_RESIDENTIAL_N_MAX);
  });

  it("cualquier tamaño > 3 en B2C se rechaza (5, 10, 100)", () => {
    for (const n of [5, 10, 100]) {
      const r = enforceMaxTeamSize("b2c_residential", n, false);
      assert.equal(r.valid, false, `esperaba rechazo para N=${n}`);
      assert.equal(r.correctedSize, 3);
    }
  });

  it("3 personas en B2C residencial es válido (el tope, no lo excede)", () => {
    const r = enforceMaxTeamSize("b2c_residential", 3, false);
    assert.equal(r.valid, true);
    assert.equal(r.correctedSize, 3);
  });

  it("1 o 2 personas en B2C residencial es válido", () => {
    assert.equal(enforceMaxTeamSize("b2c_residential", 1, false).valid, true);
    assert.equal(enforceMaxTeamSize("b2c_residential", 2, false).valid, true);
  });

  it("B2C rechazado + HHE requiere más tiempo => corrección extiende ventana, NUNCA sube N", () => {
    const r = enforceMaxTeamSize("b2c_residential", 4, true);
    assert.equal(r.valid, false);
    assert.equal(r.correctedSize, 3); // nunca 4, nunca más de 3
    assert.equal(r.extendTimeWindow, true);
  });

  it("B2C rechazado + HHE NO requiere más tiempo => no marca extender ventana (solo se recorta N)", () => {
    const r = enforceMaxTeamSize("b2c_residential", 4, false);
    assert.equal(r.valid, false);
    assert.equal(r.correctedSize, 3);
    assert.equal(r.extendTimeWindow, false);
  });

  it("B2B sin contrato provisto: sin tope, cualquier tamaño es válido", () => {
    const r = enforceMaxTeamSize("b2b", 10, false);
    assert.equal(r.valid, true);
    assert.equal(r.correctedSize, 10);
  });

  it("B2B con tope de contrato: se respeta el contrato, no un N fijo", () => {
    const r = enforceMaxTeamSize("b2b", 8, false, 6);
    assert.equal(r.valid, false);
    assert.equal(r.correctedSize, 6);
  });

  it("B2B con tope de contrato: tamaño dentro del contrato es válido", () => {
    const r = enforceMaxTeamSize("b2b", 6, false, 6);
    assert.equal(r.valid, true);
    assert.equal(r.correctedSize, 6);
  });
});

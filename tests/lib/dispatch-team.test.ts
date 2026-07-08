/**
 * v8.3 E3 — Tests de las reglas duras de formación de equipo:
 * líder obligatorio (M0-F0.5) y match de idioma (invariante B.2.13).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildTeam, type DispatchCandidate } from "../../src/lib/dispatch-team";

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

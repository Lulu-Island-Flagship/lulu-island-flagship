/**
 * v8.3 E11 — Tests de Modo Sucesión y alerta de burnout.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  lastRealEngagement,
  evaluateSuccessionStatus,
  immediateActivationReason,
  type WriteAction,
} from "../../src/lib/succession";

describe("lastRealEngagement", () => {
  it("devuelve null si no hay ninguna accion de escritura", () => {
    assert.equal(lastRealEngagement([]), null);
  });

  it("devuelve la fecha mas reciente entre varias acciones", () => {
    const actions: WriteAction[] = [
      { createdAt: "2026-06-01T00:00:00Z" },
      { createdAt: "2026-07-01T00:00:00Z" },
      { createdAt: "2026-06-15T00:00:00Z" },
    ];
    assert.equal(lastRealEngagement(actions), "2026-07-01T00:00:00Z");
  });
});

describe("evaluateSuccessionStatus — distincion login vs engagement real", () => {
  it("menos de 10 dias sin escritura = normal", () => {
    const r = evaluateSuccessionStatus("2026-07-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-07-05T00:00:00Z");
    assert.equal(r.status, "normal");
  });

  it("10-13 dias sin ESCRITURA (aunque haya habido logins) = alerta de burnout", () => {
    // La funcion ni siquiera recibe "ultimo login" como parametro -- estructuralmente
    // no puede confundirlo con actividad real. Esto ES la prueba de la distincion.
    const r = evaluateSuccessionStatus("2026-07-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-07-12T00:00:00Z");
    assert.equal(r.status, "burnout_alert");
  });

  it("14-20 dias sin escritura real = alerta de sucesion", () => {
    const r = evaluateSuccessionStatus("2026-07-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-07-16T00:00:00Z");
    assert.equal(r.status, "succession_alert");
  });

  it("21+ dias sin escritura real = activacion automatica", () => {
    const r = evaluateSuccessionStatus("2026-07-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-07-23T00:00:00Z");
    assert.equal(r.status, "auto_activate");
  });

  it("sin NINGUNA accion de escritura jamas, cuenta desde la creacion de la cuenta", () => {
    const r = evaluateSuccessionStatus(null, "2026-06-01T00:00:00Z", "2026-06-25T00:00:00Z");
    assert.equal(r.status, "auto_activate"); // 24 dias desde creacion, sin ninguna escritura
  });

  it("cuenta creada hace pocos dias sin escritura aun = normal (no penaliza el arranque)", () => {
    const r = evaluateSuccessionStatus(null, "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z");
    assert.equal(r.status, "normal");
  });
});

describe("immediateActivationReason", () => {
  it("incapacidad declarada tiene su propio mensaje", () => {
    assert.match(immediateActivationReason("incapacity_declared"), /[Ii]ncapacidad/);
  });
  it("fallecimiento certificado tiene su propio mensaje", () => {
    assert.match(immediateActivationReason("death_certified"), /[Ff]allecimiento/);
  });
});

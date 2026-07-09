import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getNoiseWindow,
  isWithinNoiseWindow,
  shouldNotifyConcierge,
  getAccessProtocol,
} from "../../src/lib/neighborhood";

describe("getNoiseWindow", () => {
  it("condominio 55+ es 9AM-5PM estricto", () => {
    const w = getNoiseWindow("condo_55plus");
    assert.equal(w.earliestHour, 9);
    assert.equal(w.latestHour, 17);
  });

  it("residencial estandar por defecto es 8AM-6PM", () => {
    const w = getNoiseWindow("residential");
    assert.equal(w.earliestHour, 8);
    assert.equal(w.latestHour, 18);
  });
});

describe("isWithinNoiseWindow", () => {
  it("las 10am en condominio 55+ esta permitido", () => {
    assert.equal(isWithinNoiseWindow("condo_55plus", 10), true);
  });
  it("las 8am en condominio 55+ NO esta permitido (antes de las 9)", () => {
    assert.equal(isWithinNoiseWindow("condo_55plus", 8), false);
  });
  it("las 6pm en condominio 55+ NO esta permitido (hora limite exclusiva)", () => {
    assert.equal(isWithinNoiseWindow("condo_55plus", 17), false);
  });
});

describe("shouldNotifyConcierge", () => {
  it("'never' nunca notifica, sin importar ausencia", () => {
    assert.equal(shouldNotifyConcierge("never", true), false);
    assert.equal(shouldNotifyConcierge("never", false), false);
  });
  it("'always' siempre notifica", () => {
    assert.equal(shouldNotifyConcierge("always", false), true);
  });
  it("'only_if_absent' depende de si el cliente estara ausente", () => {
    assert.equal(shouldNotifyConcierge("only_if_absent", true), true);
    assert.equal(shouldNotifyConcierge("only_if_absent", false), false);
  });
});

describe("getAccessProtocol", () => {
  it("los tres tipos comparten la regla de nunca desactivar camaras", () => {
    for (const type of ["fob", "front_desk", "alarm_code"] as const) {
      assert.match(getAccessProtocol(type).neverDo, /cámaras/i);
    }
  });
});

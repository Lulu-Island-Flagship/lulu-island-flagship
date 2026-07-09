import { describe, it } from "node:test";
import assert from "node:assert";
import { isVehicleInsuranceExpired, isVehicleInsuranceExpiringSoon } from "../../src/lib/vehicle-insurance";

describe("isVehicleInsuranceExpired", () => {
  it("sin fecha registrada no bloquea", () => {
    assert.equal(isVehicleInsuranceExpired(null, "2026-07-08"), false);
    assert.equal(isVehicleInsuranceExpired(undefined, "2026-07-08"), false);
  });

  it("fecha pasada = vencido", () => {
    assert.equal(isVehicleInsuranceExpired("2026-01-01", "2026-07-08"), true);
  });

  it("fecha futura = no vencido", () => {
    assert.equal(isVehicleInsuranceExpired("2027-01-01", "2026-07-08"), false);
  });

  it("fecha de hoy exactamente = no vencido todavia (vence hoy, no ayer)", () => {
    assert.equal(isVehicleInsuranceExpired("2026-07-08", "2026-07-08"), false);
  });
});

describe("isVehicleInsuranceExpiringSoon", () => {
  it("dentro de 30 dias = alerta", () => {
    assert.equal(isVehicleInsuranceExpiringSoon("2026-08-01", "2026-07-08"), true);
  });

  it("mas alla de 30 dias = sin alerta todavia", () => {
    assert.equal(isVehicleInsuranceExpiringSoon("2026-12-01", "2026-07-08"), false);
  });

  it("ya vencido no cuenta como 'expira pronto' (es otro estado)", () => {
    assert.equal(isVehicleInsuranceExpiringSoon("2026-01-01", "2026-07-08"), false);
  });
});

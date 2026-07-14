import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computePolicyStatus,
  meetsRequiredCoverage,
  missingPolicyTypes,
  REQUIRED_POLICY_TYPES,
} from "../../src/lib/business-insurance";

const TODAY = new Date("2026-07-14T12:00:00Z");

describe("computePolicyStatus", () => {
  it("active si vence en más de 30 días", () => {
    assert.equal(computePolicyStatus({ expiryDate: "2026-09-01", today: TODAY }), "active");
  });

  it("expiring_soon si vence en exactamente 30 días", () => {
    assert.equal(computePolicyStatus({ expiryDate: "2026-08-13", today: TODAY }), "expiring_soon");
  });

  it("expiring_soon si vence en 1 día", () => {
    assert.equal(computePolicyStatus({ expiryDate: "2026-07-15", today: TODAY }), "expiring_soon");
  });

  it("expired si la fecha ya pasó", () => {
    assert.equal(computePolicyStatus({ expiryDate: "2026-07-01", today: TODAY }), "expired");
  });

  it("expired si vence hoy mismo... no, vence HOY cuenta como último día activo", () => {
    // diffDays = 0 -> dentro de la ventana de 30 días -> expiring_soon, no expired
    assert.equal(computePolicyStatus({ expiryDate: "2026-07-14", today: TODAY }), "expiring_soon");
  });
});

describe("meetsRequiredCoverage", () => {
  it("true si cubre el mínimo exacto", () => {
    assert.equal(meetsRequiredCoverage({ policyType: "vehicular", coverageAmountCents: 200_000_000 }), true);
  });

  it("true si excede el mínimo", () => {
    assert.equal(meetsRequiredCoverage({ policyType: "general_liability", coverageAmountCents: 600_000_000 }), true);
  });

  it("false si está por debajo del mínimo", () => {
    assert.equal(meetsRequiredCoverage({ policyType: "errors_omissions", coverageAmountCents: 50_000_000 }), false);
  });
});

describe("missingPolicyTypes", () => {
  it("devuelve los 3 si no hay ninguna registrada", () => {
    assert.deepEqual(missingPolicyTypes([]), [...REQUIRED_POLICY_TYPES]);
  });

  it("devuelve vacío si las 3 están registradas", () => {
    assert.deepEqual(missingPolicyTypes(["vehicular", "general_liability", "errors_omissions"]), []);
  });

  it("devuelve solo las que faltan", () => {
    assert.deepEqual(missingPolicyTypes(["vehicular"]), ["general_liability", "errors_omissions"]);
  });
});

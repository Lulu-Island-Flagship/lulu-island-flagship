import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateResidentialGiftEligibility,
  createPropertyManagerBenefit,
} from "../../src/lib/gift-program";

describe("evaluateResidentialGiftEligibility", () => {
  it("menos de 12 meses activos no es elegible", () => {
    const r = evaluateResidentialGiftEligibility(6, 5000, 10000);
    assert.equal(r.eligible, false);
  });

  it("12+ meses y $2-4K cae en tier1 (cafetera/parlante $75-100)", () => {
    const r = evaluateResidentialGiftEligibility(12, 3000, 10000);
    assert.equal(r.eligible, true);
    assert.equal(r.tier?.tier, "tier1");
    assert.ok(r.suggestedGiftDollars! >= 75 && r.suggestedGiftDollars! <= 100);
  });

  it("$4-8K cae en tier2 (robot/tablet $150-225)", () => {
    const r = evaluateResidentialGiftEligibility(12, 6000, 20000);
    assert.equal(r.tier?.tier, "tier2");
  });

  it("$8K+ cae en tier3 (laptop/TV/consola $300-500)", () => {
    const r = evaluateResidentialGiftEligibility(12, 15000, 30000);
    assert.equal(r.tier?.tier, "tier3");
  });

  it("valor bajo el minimo de tier1 no es elegible", () => {
    const r = evaluateResidentialGiftEligibility(12, 1000, 10000);
    assert.equal(r.eligible, false);
  });

  it("si el regalo sugerido supera el LTV, exige aprobacion manual", () => {
    const r = evaluateResidentialGiftEligibility(12, 3000, 50); // LTV muy bajo
    assert.equal(r.requiresManualApproval, true);
  });

  it("si el LTV cubre el regalo, no exige aprobacion manual", () => {
    const r = evaluateResidentialGiftEligibility(12, 3000, 100000);
    assert.equal(r.requiresManualApproval, false);
  });
});

describe("createPropertyManagerBenefit", () => {
  it("acepta beneficio transparente al edificio", () => {
    const b = createPropertyManagerBenefit("transparent_building_benefit", "Limpieza de areas comunes trimestral");
    assert.equal(b.requiresT4A, true);
  });

  it("acepta comision de partnership declarada", () => {
    const b = createPropertyManagerBenefit("declared_partnership_commission", "5% mensual segun contrato de partnership");
    assert.equal(b.requiresT4A, true);
  });

  it("rechaza cualquier tipo que no sea uno de los dos permitidos (runtime guard)", () => {
    assert.throws(() => {
      // @ts-expect-error -- probando el guard de runtime a proposito
      createPropertyManagerBenefit("personal_gift", "iPad personal para el manager");
    }, /riesgo penal/i);
  });
});

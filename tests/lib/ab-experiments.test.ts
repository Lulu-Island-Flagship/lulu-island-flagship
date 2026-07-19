import { describe, it } from "node:test";
import assert from "node:assert";
import {
  validateVariantWeights,
  assignVariant,
  evaluateExperimentWinner,
  isProtectedRecurringClient,
} from "../../src/lib/ab-experiments";

describe("validateVariantWeights", () => {
  it("80/10/10 es valido (control mayoria, variantes <20%)", () => {
    const r = validateVariantWeights([
      { name: "control", weight: 0.8 },
      { name: "b", weight: 0.1 },
      { name: "c", weight: 0.1 },
    ]);
    assert.equal(r.valid, true);
  });

  it("rechaza variante >= al control", () => {
    const r = validateVariantWeights([
      { name: "control", weight: 0.5 },
      { name: "b", weight: 0.5 },
    ]);
    assert.equal(r.valid, false);
  });

  it("rechaza pesos que no suman 1.0", () => {
    const r = validateVariantWeights([
      { name: "control", weight: 0.8 },
      { name: "b", weight: 0.1 },
    ]);
    assert.equal(r.valid, false);
  });

  it("rechaza menos de 2 variantes", () => {
    const r = validateVariantWeights([{ name: "control", weight: 1 }]);
    assert.equal(r.valid, false);
  });
});

describe("assignVariant", () => {
  const variants = [
    { name: "control", weight: 0.8 },
    { name: "b", weight: 0.2 },
  ];

  it("cliente recurrente SIEMPRE queda excluido, sin excepcion", () => {
    const r = assignVariant({ clientId: "c1", isRecurring: true }, variants);
    assert.equal(r.variant, null);
    assert.match(r.excludedReason!, /recurrente/i);
  });

  it("mismo clientId siempre recibe la misma variante (determinismo)", () => {
    const a = assignVariant({ clientId: "client-abc", isRecurring: false }, variants);
    const b = assignVariant({ clientId: "client-abc", isRecurring: false }, variants);
    assert.equal(a.variant, b.variant);
  });

  it("configuracion invalida excluye al cliente en vez de asignar variante", () => {
    const r = assignVariant(
      { clientId: "c1", isRecurring: false },
      [{ name: "control", weight: 0.5 }, { name: "b", weight: 0.5 }]
    );
    assert.equal(r.variant, null);
  });

  it("ignora demographicGroup por completo (no se usa en el hash ni en la logica)", () => {
    const a = assignVariant({ clientId: "c1", isRecurring: false, demographicGroup: "A" }, variants);
    const b = assignVariant({ clientId: "c1", isRecurring: false, demographicGroup: "B" }, variants);
    assert.equal(a.variant, b.variant);
  });
});

describe("isProtectedRecurringClient", () => {
  it("protege a un cliente con contrato activo (recurrente clasico)", () => {
    assert.equal(isProtectedRecurringClient(true, null), true);
  });

  it("protege a un cliente VIP aunque NO tenga contrato activo (auditoria E10)", () => {
    assert.equal(isProtectedRecurringClient(false, "vip"), true);
  });

  it("protege a un cliente Regular aunque NO tenga contrato activo (auditoria E10)", () => {
    assert.equal(isProtectedRecurringClient(false, "regular"), true);
  });

  it("NO protege a un cliente Esporadico sin contrato activo", () => {
    assert.equal(isProtectedRecurringClient(false, "sporadic"), false);
  });

  it("NO protege a un cliente Nuevo sin contrato activo", () => {
    assert.equal(isProtectedRecurringClient(false, "new"), false);
  });

  it("NO protege a un cliente En riesgo sin contrato activo", () => {
    assert.equal(isProtectedRecurringClient(false, "at_risk"), false);
  });
});

describe("assignVariant + isProtectedRecurringClient integrados", () => {
  const variants = [
    { name: "control", weight: 0.8 },
    { name: "b", weight: 0.2 },
  ];

  it("cliente VIP sin contrato activo queda excluido del experimento (no solo isRecurring por contrato)", () => {
    const isRecurring = isProtectedRecurringClient(false, "vip");
    const r = assignVariant({ clientId: "vip-sin-contrato", isRecurring }, variants);
    assert.equal(r.variant, null);
    assert.match(r.excludedReason!, /recurrente/i);
  });

  it("cliente Esporadico sin contrato SI puede entrar al experimento", () => {
    const isRecurring = isProtectedRecurringClient(false, "sporadic");
    const r = assignVariant({ clientId: "esporadico-sin-contrato", isRecurring }, variants);
    assert.notEqual(r.variant, null);
  });
});

describe("evaluateExperimentWinner", () => {
  it("precio: exige minimo 100 muestras por variante", () => {
    const r = evaluateExperimentWinner(
      [
        { variant: "control", sampleSize: 50, conversionRate: 0.2, marginRatio: 0.4 },
        { variant: "b", sampleSize: 100, conversionRate: 0.25, marginRatio: 0.35 },
      ],
      "price",
      0.97
    );
    assert.equal(r.hasWinner, false);
  });

  it("precio: metrica es conversion x margen, no solo conversion", () => {
    const r = evaluateExperimentWinner(
      [
        { variant: "control", sampleSize: 100, conversionRate: 0.3, marginRatio: 0.4 }, // 0.12
        { variant: "descuento", sampleSize: 100, conversionRate: 0.5, marginRatio: 0.15 }, // 0.075
      ],
      "price",
      0.97
    );
    assert.equal(r.hasWinner, true);
    assert.equal(r.winner, "control"); // gana pese a convertir menos, porque el margen compensa
  });

  it("sin confianza suficiente no hay ganador aunque haya muestra", () => {
    const r = evaluateExperimentWinner(
      [
        { variant: "control", sampleSize: 100, conversionRate: 0.3, marginRatio: 0.4 },
        { variant: "b", sampleSize: 100, conversionRate: 0.35, marginRatio: 0.4 },
      ],
      "price",
      0.9
    );
    assert.equal(r.hasWinner, false);
  });

  it("copy: exige 500 interacciones, no 100", () => {
    const r = evaluateExperimentWinner(
      [
        { variant: "control", sampleSize: 200, conversionRate: 0.3, marginRatio: 0.4 },
        { variant: "b", sampleSize: 200, conversionRate: 0.35, marginRatio: 0.4 },
      ],
      "copy",
      0.97
    );
    assert.equal(r.hasWinner, false);
  });
});

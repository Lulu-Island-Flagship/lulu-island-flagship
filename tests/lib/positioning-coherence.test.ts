import { describe, it } from "node:test";
import assert from "node:assert";
import { validatePositioningCoherence } from "../../src/lib/positioning-coherence";

describe("validatePositioningCoherence", () => {
  it("'asegurados' con flag de pólizas APAGADO es violación (criterio de aceptación E10 explícito)", () => {
    const r = validatePositioningCoherence("Somos un equipo verificado y asegurado.", {
      bondedPolicyFlagActive: false,
    });
    assert.equal(r.passes, false);
    assert.equal(r.violations[0].category, "unsubstantiated_bonded_claim");
  });

  it("'bonded' en inglés con flag apagado también es violación", () => {
    const r = validatePositioningCoherence("Fully bonded and background-checked team.", {
      bondedPolicyFlagActive: false,
    });
    assert.equal(r.passes, false);
  });

  it("'asegurados' con flag de pólizas ACTIVO pasa", () => {
    const r = validatePositioningCoherence("Somos un equipo verificado y asegurado.", {
      bondedPolicyFlagActive: true,
    });
    assert.equal(r.passes, true);
  });

  it("texto sin mención de seguros pasa con flag apagado", () => {
    const r = validatePositioningCoherence("El mismo equipo de confianza, cada vez.", {
      bondedPolicyFlagActive: false,
    });
    assert.equal(r.passes, true);
  });

  it("'descuento' rompe el tono premium (B.2.24)", () => {
    const r = validatePositioningCoherence("Aproveche este descuento especial hoy.", {
      bondedPolicyFlagActive: true,
    });
    assert.equal(r.passes, false);
    assert.equal(r.violations[0].category, "discount_tone");
  });

  it("'oferta' y 'barato' rompen el tono premium", () => {
    const r1 = validatePositioningCoherence("Nuestra oferta de la semana.", { bondedPolicyFlagActive: true });
    const r2 = validatePositioningCoherence("El servicio más barato de Richmond.", { bondedPolicyFlagActive: true });
    assert.equal(r1.passes, false);
    assert.equal(r2.passes, false);
  });

  it("tono de inversión/cuidado sin palabras prohibidas pasa", () => {
    const r = validatePositioningCoherence(
      "Precio completo desde la cotización, sin sorpresas. Una inversión en la tranquilidad de su hogar.",
      { bondedPolicyFlagActive: false }
    );
    assert.equal(r.passes, true);
  });

  it("puede acumular violacion de bonded Y de tono en el mismo texto", () => {
    const r = validatePositioningCoherence("Oferta especial: equipo asegurado a precio de descuento.", {
      bondedPolicyFlagActive: false,
    });
    assert.equal(r.passes, false);
    const categories = r.violations.map((v) => v.category);
    assert.ok(categories.includes("unsubstantiated_bonded_claim"));
    assert.ok(categories.includes("discount_tone"));
  });

  it("'aseguramos la calidad' no debe confundirse (palabra 'aseguramos' no matchea 'asegurad[oa]s')", () => {
    const r = validatePositioningCoherence("Aseguramos la calidad de cada servicio.", {
      bondedPolicyFlagActive: false,
    });
    assert.equal(r.passes, true);
  });
});

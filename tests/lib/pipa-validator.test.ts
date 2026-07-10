import { describe, it } from "node:test";
import assert from "node:assert";
import { validateMarketingCopy } from "../../src/lib/pipa-validator";

describe("validateMarketingCopy", () => {
  it("lenguaje permitido del spec ('basado en su historial de servicio') pasa", () => {
    const r = validateMarketingCopy(
      "Basado en su historial de servicio, le sugerimos añadir el protocolo profundo de cocina."
    );
    assert.equal(r.passes, true);
    assert.deepEqual(r.violations, []);
  });

  it("'detectamos alérgenos' es inferencia médica prohibida (ejemplo literal del spec)", () => {
    const r = validateMarketingCopy("En su última visita detectamos alérgenos en la alfombra.");
    assert.equal(r.passes, false);
    assert.equal(r.violations[0].category, "medical_inference");
  });

  it("'detectamos moho tóxico' es inferencia médica prohibida", () => {
    const r = validateMarketingCopy("Nuestro equipo detectamos moho tóxico bajo el fregadero.");
    assert.equal(r.passes, false);
  });

  it("diagnóstico médico directo es prohibido", () => {
    const r = validateMarketingCopy("Con estos síntomas, le diagnosticamos posible asma por polvo.");
    assert.equal(r.passes, false);
  });

  it("texto neutral sin datos identificables pasa sin consentimiento", () => {
    const r = validateMarketingCopy("Nuestros clientes en Richmond confían en el mismo equipo cada semana.");
    assert.equal(r.passes, true);
  });

  it("email de un cliente sin consentimiento de marketing es violación", () => {
    const r = validateMarketingCopy("Gracias a maria.lopez@example.com por su reseña de 5 estrellas.");
    assert.equal(r.passes, false);
    assert.equal(r.violations[0].category, "client_identification");
  });

  it("teléfono de un cliente sin consentimiento es violación", () => {
    const r = validateMarketingCopy("Contactamos a nuestro cliente al 604-555-0134 para agradecerle.");
    assert.equal(r.passes, false);
  });

  it("dirección identificable sin consentimiento es violación", () => {
    const r = validateMarketingCopy("Esta transformación fue en 4521 Garden City Road, Richmond.");
    assert.equal(r.passes, false);
  });

  it("dirección identificable CON consentimiento de marketing pasa", () => {
    const r = validateMarketingCopy(
      "Esta transformación fue en 4521 Garden City Road, Richmond.",
      { hasMarketingConsent: true }
    );
    assert.equal(r.passes, true);
  });

  it("inferencia médica NO se perdona aunque haya consentimiento de marketing (son categorías independientes)", () => {
    const r = validateMarketingCopy("Detectamos alérgenos en su hogar.", { hasMarketingConsent: true });
    assert.equal(r.passes, false);
    assert.equal(r.violations[0].category, "medical_inference");
  });

  it("puede acumular violaciones de ambas categorías en el mismo texto", () => {
    const r = validateMarketingCopy(
      "Detectamos alérgenos en casa de nuestro cliente en 4521 Garden City Road."
    );
    assert.equal(r.passes, false);
    assert.ok(r.violations.length >= 2);
    const categories = r.violations.map((v) => v.category);
    assert.ok(categories.includes("medical_inference"));
    assert.ok(categories.includes("client_identification"));
  });
});

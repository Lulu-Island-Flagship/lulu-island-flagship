import { describe, it } from "node:test";
import assert from "node:assert";
import { isValidLanguageLevels, hasFluentMatch } from "../../src/lib/employee-languages";

describe("isValidLanguageLevels", () => {
  it("acepta un objeto vacío", () => {
    assert.equal(isValidLanguageLevels({}, ["en"]), true);
  });

  it("rechaza arrays", () => {
    assert.equal(isValidLanguageLevels(["en"], ["en"]), false);
  });

  it("rechaza null", () => {
    assert.equal(isValidLanguageLevels(null, ["en"]), false);
  });

  it("acepta niveles válidos para idiomas hablados", () => {
    assert.equal(isValidLanguageLevels({ en: "native", zh: "fluent" }, ["en", "zh"]), true);
  });

  it("rechaza un idioma no soportado", () => {
    assert.equal(isValidLanguageLevels({ fr: "native" }, ["fr"]), false);
  });

  it("rechaza un idioma que el empleado no habla (no está en spokenLanguages)", () => {
    assert.equal(isValidLanguageLevels({ zh: "native" }, ["en"]), false);
  });

  it("rechaza un nivel inválido", () => {
    assert.equal(isValidLanguageLevels({ en: "expert" }, ["en"]), false);
  });
});

describe("hasFluentMatch", () => {
  it("true si tiene fluent en un idioma de la cuenta", () => {
    assert.equal(hasFluentMatch({ en: "fluent" }, ["zh", "en"]), true);
  });

  it("true si tiene native en un idioma de la cuenta", () => {
    assert.equal(hasFluentMatch({ zh: "native" }, ["zh"]), true);
  });

  it("false si solo tiene basic/intermediate", () => {
    assert.equal(hasFluentMatch({ en: "basic", zh: "intermediate" }, ["en", "zh"]), false);
  });

  it("false si no hay match de idioma en absoluto", () => {
    assert.equal(hasFluentMatch({ en: "native" }, ["zh"]), false);
  });
});

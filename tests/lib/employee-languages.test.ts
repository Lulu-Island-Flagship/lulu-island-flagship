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
    // v8.3 fix B-3 (auditoría implacable 2026-07-20b): SUPPORTED_LANGUAGE_CODES
    // pasó de en/zh/es a en/zh/fr -- este test usaba "fr" como ejemplo de
    // idioma NO soportado, justo el que ahora sí lo es. "es" (español) ya
    // no es un idioma válido de la app (ver src/lib/languages.ts), así que
    // es el ejemplo correcto de código rechazado.
    assert.equal(isValidLanguageLevels({ es: "native" }, ["es"]), false);
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

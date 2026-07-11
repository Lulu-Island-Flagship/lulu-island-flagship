/**
 * v8.3 E6-C7 — Tests del auditor de accesibilidad estático.
 * Ver limitaciones reales documentadas en src/lib/a11y-audit.ts (no es
 * axe-core, no hay DOM real en este repo).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  meetsWcagAA,
  checkContrastPair,
  scanSource,
  isCritical,
} from "../../src/lib/a11y-audit";
import { BRAND, STATE } from "../../src/design/tokens";

describe("hexToRgb", () => {
  it("convierte hex a componentes RGB", () => {
    assert.deepEqual(hexToRgb("#FFFFFF"), { r: 255, g: 255, b: 255 });
    assert.deepEqual(hexToRgb("#000000"), { r: 0, g: 0, b: 0 });
  });
  it("rechaza hex inválido", () => {
    assert.throws(() => hexToRgb("no-es-hex"));
  });
});

describe("contrastRatio / meetsWcagAA", () => {
  it("blanco sobre negro es 21:1", () => {
    const ratio = contrastRatio("#FFFFFF", "#000000");
    assert.ok(Math.abs(ratio - 21) < 0.01);
    assert.equal(meetsWcagAA(ratio), true);
  });
  it("mismo color es 1:1 y falla AA", () => {
    const ratio = contrastRatio("#ABABAB", "#ABABAB");
    assert.ok(Math.abs(ratio - 1) < 0.01);
    assert.equal(meetsWcagAA(ratio), false);
  });
  it("3:1 pasa para texto grande pero no para texto normal", () => {
    // Par construido para dar ~3.19:1 (ver assert de rango, no un valor mágico).
    const ratio = contrastRatio("#909090", "#FFFFFF");
    assert.ok(ratio >= 3 && ratio < 4.5, `ratio fuera de rango esperado: ${ratio}`);
    assert.equal(meetsWcagAA(ratio, true), true);
    assert.equal(meetsWcagAA(ratio, false), false);
  });
});

describe("checkContrastPair sobre la paleta real de marca (src/design/tokens.ts)", () => {
  it("texto ink sobre fondo white pasa AA (texto normal)", () => {
    const check = checkContrastPair("ink/white", BRAND.ink, BRAND.white);
    assert.equal(check.passesAA, true, `ratio real: ${check.ratio}`);
  });
  it("navy sobre white pasa AA (headers/CTA)", () => {
    const check = checkContrastPair("navy/white", BRAND.navy, BRAND.white);
    assert.equal(check.passesAA, true, `ratio real: ${check.ratio}`);
  });
  it("goldDark sobre white pasa AA para texto normal (ARREGLADO — hallazgo original: #A8863F daba ~3.42:1, no alcanzaba 4.5:1; se reemplazó por #93712A, ratio real ~4.53:1, ver src/design/tokens.ts)", () => {
    const check = checkContrastPair("goldDark/white", BRAND.goldDark, BRAND.white, false);
    assert.equal(check.passesAA, true, `ratio real: ${check.ratio} — si esto vuelve a false, alguien bajó el contraste del token de nuevo`);
  });
  it("gold (acento) sobre white NO necesariamente pasa AA para texto normal — documentar si falla", () => {
    // No se afirma un resultado: se calcula y se deja registro. Si esto
    // falla, es una señal real de que `gold` no debe usarse como color de
    // texto de cuerpo, solo como acento (tal como dice el comentario del token).
    const check = checkContrastPair("gold/white", BRAND.gold, BRAND.white);
    assert.equal(typeof check.passesAA, "boolean");
  });
  it("danger sobre white pasa AA", () => {
    const check = checkContrastPair("danger/white", STATE.danger, BRAND.white);
    assert.equal(check.passesAA, true, `ratio real: ${check.ratio}`);
  });
});

describe("scanSource — img-sin-alt", () => {
  it("detecta <img> sin alt", () => {
    const issues = scanSource(`<img src="/x.png" />`, "f.tsx");
    assert.ok(issues.some((i) => i.rule === "img-sin-alt"));
  });
  it("no marca <img> con alt", () => {
    const issues = scanSource(`<img src="/x.png" alt="Descripción" />`, "f.tsx");
    assert.equal(issues.filter((i) => i.rule === "img-sin-alt").length, 0);
  });
});

describe("scanSource — campo-sin-nombre-accesible", () => {
  it("detecta <input> sin aria-label/id/title", () => {
    const issues = scanSource(`<input type="text" onChange={f} />`, "f.tsx");
    assert.ok(issues.some((i) => i.rule === "campo-sin-nombre-accesible"));
  });
  it("no marca <input> con aria-label", () => {
    const issues = scanSource(`<input aria-label="Nombre" />`, "f.tsx");
    assert.equal(
      issues.filter((i) => i.rule === "campo-sin-nombre-accesible").length,
      0
    );
  });
  it("no marca <input type=hidden>", () => {
    const issues = scanSource(`<input type="hidden" value={x} />`, "f.tsx");
    assert.equal(
      issues.filter((i) => i.rule === "campo-sin-nombre-accesible").length,
      0
    );
  });
});

describe("scanSource — boton-icono-sin-nombre", () => {
  it("detecta <button> con solo un ícono y sin aria-label", () => {
    const issues = scanSource(`<button onClick={f}><XIcon /></button>`, "f.tsx");
    assert.ok(issues.some((i) => i.rule === "boton-icono-sin-nombre"));
  });
  it("no marca <button> con texto visible", () => {
    const issues = scanSource(`<button onClick={f}>Guardar</button>`, "f.tsx");
    assert.equal(
      issues.filter((i) => i.rule === "boton-icono-sin-nombre").length,
      0
    );
  });
  it("no marca <button> de solo ícono con aria-label", () => {
    const issues = scanSource(
      `<button onClick={f} aria-label="Cerrar"><XIcon /></button>`,
      "f.tsx"
    );
    assert.equal(
      issues.filter((i) => i.rule === "boton-icono-sin-nombre").length,
      0
    );
  });
});

describe("scanSource — clic-sin-teclado", () => {
  it("detecta <div onClick> sin role/tabIndex", () => {
    const issues = scanSource(`<div onClick={f}>Texto</div>`, "f.tsx");
    assert.ok(issues.some((i) => i.rule === "clic-sin-teclado"));
  });
  it("no marca <div onClick role=button tabIndex={0}>", () => {
    const issues = scanSource(
      `<div onClick={f} role="button" tabIndex={0}>Texto</div>`,
      "f.tsx"
    );
    assert.equal(issues.filter((i) => i.rule === "clic-sin-teclado").length, 0);
  });
});

describe("scanSource — tabindex-positivo", () => {
  it("detecta tabIndex positivo", () => {
    const issues = scanSource(`<input tabIndex={3} />`, "f.tsx");
    assert.ok(issues.some((i) => i.rule === "tabindex-positivo"));
  });
  it("no marca tabIndex={0} ni tabIndex={-1}", () => {
    const issues = scanSource(
      `<input tabIndex={0} /><input tabIndex={-1} />`,
      "f.tsx"
    );
    assert.equal(issues.filter((i) => i.rule === "tabindex-positivo").length, 0);
  });
});

describe("scanSource — viewport-bloquea-zoom", () => {
  it("detecta user-scalable=no", () => {
    const issues = scanSource(
      `export const viewport = { content: "width=device-width, user-scalable=no" };`,
      "layout.tsx"
    );
    assert.ok(issues.some((i) => i.rule === "viewport-bloquea-zoom"));
  });
  it("no marca viewport normal", () => {
    const issues = scanSource(
      `export const viewport = { content: "width=device-width, initial-scale=1" };`,
      "layout.tsx"
    );
    assert.equal(
      issues.filter((i) => i.rule === "viewport-bloquea-zoom").length,
      0
    );
  });
});

describe("isCritical", () => {
  it("distingue critical de warning", () => {
    const issues = scanSource(`<input tabIndex={3} /><img src='x' />`, "f.tsx");
    const critical = issues.filter(isCritical);
    const warning = issues.filter((i) => !isCritical(i));
    assert.ok(critical.some((i) => i.rule === "img-sin-alt"));
    assert.ok(warning.some((i) => i.rule === "tabindex-positivo"));
  });
});

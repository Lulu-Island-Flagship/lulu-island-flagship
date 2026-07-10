/**
 * v8.3 E4 — Tests del candado químico (B.2.8: 3 señales redundantes, nunca
 * solo color).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  CHEMICAL_CODES,
  getChemicalCode,
  areIncompatible,
  isValidConfirmation,
  isZoneUnlocked,
  applyConfirmation,
  detectHazard,
} from "../../src/lib/chemical-lockout";

describe("CHEMICAL_CODES", () => {
  it("tiene las 6 entradas de D.5, cada una con color + icono + texto", () => {
    assert.equal(CHEMICAL_CODES.length, 6);
    for (const c of CHEMICAL_CODES) {
      assert.ok(c.color);
      assert.ok(c.icon);
      assert.ok(c.textEn);
      assert.ok(c.textEs);
    }
  });
});

describe("areIncompatible", () => {
  it("rojo y azul son incompatibles (ácido + amonio → gas cloro)", () => {
    assert.equal(areIncompatible("red", "blue"), true);
    assert.equal(areIncompatible("blue", "red"), true);
  });
  it("verde es compatible con todo", () => {
    assert.equal(areIncompatible("green", "red"), false);
    assert.equal(areIncompatible("green", "blue"), false);
  });
  it("colores no relacionados no son incompatibles", () => {
    assert.equal(areIncompatible("yellow", "white"), false);
  });
});

describe("isValidConfirmation", () => {
  it("acepta cuando color+icono+texto coinciden con el código objetivo", () => {
    const red = getChemicalCode("red")!;
    assert.equal(
      isValidConfirmation({
        targetColor: "red",
        selectedColor: "red",
        selectedIcon: red.icon,
        selectedText: red.textEn,
      }),
      true
    );
  });

  it("rechaza si el color coincide pero el ícono no (nunca solo color)", () => {
    const red = getChemicalCode("red")!;
    assert.equal(
      isValidConfirmation({
        targetColor: "red",
        selectedColor: "red",
        selectedIcon: "🍳", // ícono de cocina, no de baño
        selectedText: red.textEn,
      }),
      false
    );
  });

  it("rechaza si el texto coincide pero el color no", () => {
    const red = getChemicalCode("red")!;
    assert.equal(
      isValidConfirmation({
        targetColor: "red",
        selectedColor: "blue",
        selectedIcon: red.icon,
        selectedText: red.textEn,
      }),
      false
    );
  });

  it("rechaza un color desconocido", () => {
    assert.equal(
      isValidConfirmation({
        targetColor: "purple",
        selectedColor: "purple",
        selectedIcon: "?",
        selectedText: "?",
      }),
      false
    );
  });
});

describe("isZoneUnlocked / applyConfirmation", () => {
  it("una zona empieza bloqueada sin confirmación previa", () => {
    assert.equal(isZoneUnlocked("red", new Set()), false);
  });

  it("una confirmación válida desbloquea la zona de ese color, sin mutar el set original", () => {
    const original = new Set<string>();
    const red = getChemicalCode("red")!;
    const result = applyConfirmation(original, {
      targetColor: "red",
      selectedColor: "red",
      selectedIcon: red.icon,
      selectedText: red.textEn,
    });
    assert.equal(result.ok, true);
    assert.equal(isZoneUnlocked("red", result.confirmedColors), true);
    // el set original no se tocó
    assert.equal(original.size, 0);
  });

  it("una confirmación inválida no desbloquea nada", () => {
    const result = applyConfirmation(new Set(), {
      targetColor: "red",
      selectedColor: "red",
      selectedIcon: "icono incorrecto",
      selectedText: "texto incorrecto",
    });
    assert.equal(result.ok, false);
    assert.equal(result.confirmedColors.size, 0);
    assert.ok(result.error);
  });

  it("confirmar un color no desbloquea otros colores", () => {
    const red = getChemicalCode("red")!;
    const result = applyConfirmation(new Set(), {
      targetColor: "red",
      selectedColor: "red",
      selectedIcon: red.icon,
      selectedText: red.textEn,
    });
    assert.equal(isZoneUnlocked("blue", result.confirmedColors), false);
  });
});

describe("detectHazard", () => {
  it("detecta el conflicto rojo/azul cuando uno ya está activo", () => {
    const active = new Set(["red"]);
    const result = detectHazard("blue", active);
    assert.equal(result.hazard, true);
    assert.equal(result.conflictingColor, "red");
  });

  it("sin conflicto, no hay peligro", () => {
    const active = new Set(["green", "yellow"]);
    const result = detectHazard("black", active);
    assert.equal(result.hazard, false);
  });

  it("set vacío nunca genera peligro", () => {
    assert.equal(detectHazard("red", new Set()).hazard, false);
  });
});

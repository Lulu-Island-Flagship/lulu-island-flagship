/**
 * v8.3 E4.11 — Tests del Protocolo de Cierre Externo (los 5 requisitos de
 * COMPLETADO, sin contar T_out mismo que dispara la evaluación).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateClosureProtocol,
  type ZoneClosureStatus,
} from "../../src/lib/closure-protocol";

const zone = (over: Partial<ZoneClosureStatus>): ZoneClosureStatus => ({
  zone: "bathroom",
  zoneLabel: "Baño",
  totalItems: 4,
  completedItems: 4,
  hasAfterPhoto: true,
  ...over,
});

describe("evaluateClosureProtocol", () => {
  it("completo cuando los 4 requisitos se cumplen", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({})],
      implementsConfirmed: true,
      externalConfirmation: "client_verbal",
    });
    assert.equal(result.complete, true);
    assert.deepEqual(result.missing, []);
  });

  it("rechaza si el checklist no está 100% verde", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({ completedItems: 3 })],
      implementsConfirmed: true,
      externalConfirmation: "client_verbal",
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.some((m) => m.includes("Checklist incompleto")));
  });

  it("rechaza si falta foto 'después' en una zona", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({ hasAfterPhoto: false })],
      implementsConfirmed: true,
      externalConfirmation: "client_verbal",
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.some((m) => m.includes('foto "después"')));
  });

  it("rechaza si los implementos no están confirmados", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({})],
      implementsConfirmed: false,
      externalConfirmation: "client_verbal",
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.some((m) => m.includes("Implementos")));
  });

  it("rechaza si no hay confirmación externa", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({})],
      implementsConfirmed: true,
      externalConfirmation: null,
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.some((m) => m.includes("confirmación externa")));
  });

  it("rechaza si no hay checklist cargado (cero zonas)", () => {
    const result = evaluateClosureProtocol({
      zones: [],
      implementsConfirmed: true,
      externalConfirmation: "auditor_present",
    });
    assert.equal(result.complete, false);
    assert.ok(result.missing.some((m) => m.includes("No hay checklist")));
  });

  it("una zona sin ítems (totalItems=0) no bloquea por checklist ni foto", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({ totalItems: 0, completedItems: 0, hasAfterPhoto: false })],
      implementsConfirmed: true,
      externalConfirmation: "leader_audit",
    });
    assert.equal(result.complete, true);
  });

  it("acumula todos los mensajes faltantes a la vez, no solo el primero", () => {
    const result = evaluateClosureProtocol({
      zones: [zone({ completedItems: 2, hasAfterPhoto: false })],
      implementsConfirmed: false,
      externalConfirmation: null,
    });
    assert.equal(result.complete, false);
    assert.equal(result.missing.length, 4);
  });
});

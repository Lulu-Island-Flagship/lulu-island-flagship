import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateBreakGlassEntry, isBreakGlassRevoked } from "../../scripts/verify-invariants.mjs";

describe("Gate break-glass · validateBreakGlassEntry (LEARNING-005)", () => {
  const baseNow = new Date("2026-08-15T12:00:00Z").getTime();

  it("acepta un asiento válido y vigente con TTL derivado exacto", () => {
    const entry = {
      activacion_id: "BG-2026-08-15-001",
      motivo: "SEV-0 fallo de emergencia",
      firmas: ["oncall-1", "oncall-2"],
      privilegios: ["admin_payroll_write"],
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 4,
      expira_en: "2026-08-15T14:00:00Z",
      alerta_p0: true,
      incident_to_test: "tests/lib/emergency-fix.test.ts",
    };

    const violations = validateBreakGlassEntry(entry, baseNow, "test-entry");
    assert.deepEqual(violations, []);
  });

  it("rechaza un asiento con expira_en incoherente con ttl_horas (TTL derivado)", () => {
    // Simula la vulnerabilidad de LEARNING-005: declara ttl 4h pero expira 10 días después
    const entry = {
      activacion_id: "BG-2026-08-15-002",
      motivo: "SEV-0",
      firmas: ["oncall-1"],
      privilegios: ["admin_write"],
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 4,
      expira_en: "2026-08-25T10:00:00Z",
      alerta_p0: true,
    };

    const violations = validateBreakGlassEntry(entry, baseNow, "test-entry");
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.includes("TTL real incoherente")));
  });

  it("rechaza ttl_horas superior a 24", () => {
    const entry = {
      activacion_id: "BG-2026-08-15-003",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 48,
      expira_en: "2026-08-17T10:00:00Z",
    };

    const violations = validateBreakGlassEntry(entry, baseNow, "test-entry");
    assert.ok(violations.some((v) => v.includes("excede el máximo de 24") || v.includes("inválido")));
  });

  it("rechaza ttl_horas <= 0 o no numérico", () => {
    const entryZero = {
      activacion_id: "BG-2026-08-15-004",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 0,
      expira_en: "2026-08-15T10:00:00Z",
    };
    const violationsZero = validateBreakGlassEntry(entryZero, baseNow, "test-zero");
    assert.ok(violationsZero.some((v) => v.includes("inválido")));

    const entryStr = {
      activacion_id: "BG-2026-08-15-005",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: "24",
      expira_en: "2026-08-16T10:00:00Z",
    };
    const violationsStr = validateBreakGlassEntry(entryStr, baseNow, "test-str");
    assert.ok(violationsStr.some((v) => v.includes("debe ser numérico")));
  });

  it("rechaza fechas con formato ISO inválido", () => {
    const entry = {
      activacion_id: "BG-2026-08-15-006",
      activado_en: "ayer por la tarde",
      ttl_horas: 4,
      expira_en: "2026-08-15T14:00:00Z",
    };

    const violations = validateBreakGlassEntry(entry, baseNow, "test-entry");
    assert.ok(violations.some((v) => v.includes("`activado_en` debe ser una fecha ISO 8601 válida")));
  });

  it("rechaza una activación expirada si no está marcada como revocada", () => {
    const nowAfterExpiry = new Date("2026-08-15T15:00:00Z").getTime();
    const entry = {
      activacion_id: "BG-2026-08-15-007",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 4,
      expira_en: "2026-08-15T14:00:00Z",
    };

    const violations = validateBreakGlassEntry(entry, nowAfterExpiry, "test-entry");
    assert.ok(violations.some((v) => v.includes("no marcada como revocada")));
  });

  it("acepta una activación expirada si tiene revocado_en o estado REVOCADO / REVOCADA", () => {
    const nowAfterExpiry = new Date("2026-08-15T15:00:00Z").getTime();

    const entryWithTimestamp = {
      activacion_id: "BG-2026-08-15-008",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 4,
      expira_en: "2026-08-15T14:00:00Z",
      revocado_en: "2026-08-15T14:00:00Z",
    };
    assert.deepEqual(validateBreakGlassEntry(entryWithTimestamp, nowAfterExpiry, "t1"), []);

    const entryMasculino = {
      activacion_id: "BG-2026-08-15-009",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 4,
      expira_en: "2026-08-15T14:00:00Z",
      estado: "REVOCADO",
    };
    assert.deepEqual(validateBreakGlassEntry(entryMasculino, nowAfterExpiry, "t2"), []);

    const entryFemenino = {
      activacion_id: "BG-2026-08-15-010",
      activado_en: "2026-08-15T10:00:00Z",
      ttl_horas: 4,
      expira_en: "2026-08-15T14:00:00Z",
      estado: "REVOCADA",
    };
    assert.deepEqual(validateBreakGlassEntry(entryFemenino, nowAfterExpiry, "t3"), []);
  });
});

describe("Gate break-glass · isBreakGlassRevoked", () => {
  it("reconoce todos los formatos canónicos de revocación", () => {
    assert.equal(isBreakGlassRevoked({ revocado_en: "2026-08-15T12:00:00Z" }), true);
    assert.equal(isBreakGlassRevoked({ revocada: true }), true);
    assert.equal(isBreakGlassRevoked({ revocado: true }), true);
    assert.equal(isBreakGlassRevoked({ estado: "REVOCADO" }), true);
    assert.equal(isBreakGlassRevoked({ estado: "revocado" }), true);
    assert.equal(isBreakGlassRevoked({ estado: "REVOCADA" }), true);
    assert.equal(isBreakGlassRevoked({ estado: "revocada" }), true);
    assert.equal(isBreakGlassRevoked({ estado: "ACTIVO" }), false);
    assert.equal(isBreakGlassRevoked(null), false);
  });
});

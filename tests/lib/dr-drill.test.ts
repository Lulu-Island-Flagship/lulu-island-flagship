import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateDrillResult,
  computeDrillOverdueStatus,
  computeAllDrillOverdueStatuses,
  type IntegrityCheckResult,
} from "../../src/lib/dr-drill";

const cleanCheck: IntegrityCheckResult = {
  rowCounts: { orders: 10, quotes: 10, employees: 5, payroll_entries: 20, assignments: 10, config_snapshots: 3 },
  referentialIntegrity: {
    orphan_orders_without_quote: 0,
    orphan_payroll_without_employee: 0,
    orphan_assignments_without_order: 0,
  },
  passed: true,
};

describe("evaluateDrillResult", () => {
  it("pass cuando integridad OK y sin RTO para comparar", () => {
    const r = evaluateDrillResult(cleanCheck);
    assert.equal(r.result, "pass");
    assert.equal(r.withinRto, null);
  });

  it("pass cuando integridad OK y dentro de RTO", () => {
    const r = evaluateDrillResult(cleanCheck, { durationSeconds: 3600, rtoHours: 48 });
    assert.equal(r.result, "pass");
    assert.equal(r.withinRto, true);
  });

  it("partial cuando integridad OK pero excede el RTO declarado", () => {
    const r = evaluateDrillResult(cleanCheck, { durationSeconds: 200000, rtoHours: 48 });
    assert.equal(r.result, "partial");
    assert.equal(r.withinRto, false);
    assert.ok(r.reasons.some((m) => m.includes("excede el RTO")));
  });

  it("fail cuando hay huérfanos referenciales, sin importar el RTO", () => {
    const broken: IntegrityCheckResult = {
      ...cleanCheck,
      referentialIntegrity: { ...cleanCheck.referentialIntegrity, orphan_orders_without_quote: 3 },
      passed: false,
    };
    const r = evaluateDrillResult(broken, { durationSeconds: 10, rtoHours: 48 });
    assert.equal(r.result, "fail");
    assert.ok(r.reasons.some((m) => m.includes("orphan_orders_without_quote")));
  });

  it("fail cuando una tabla crítica esperada queda vacía", () => {
    const empty: IntegrityCheckResult = {
      ...cleanCheck,
      rowCounts: { ...cleanCheck.rowCounts, orders: 0 },
    };
    const r = evaluateDrillResult(empty, { criticalTablesExpectedNonEmpty: ["orders"] });
    assert.equal(r.result, "fail");
    assert.ok(r.reasons.some((m) => m.includes("orders")));
  });

  it("fail tiene prioridad sobre partial (huérfanos Y fuera de RTO a la vez)", () => {
    const broken: IntegrityCheckResult = {
      ...cleanCheck,
      referentialIntegrity: { ...cleanCheck.referentialIntegrity, orphan_orders_without_quote: 1 },
      passed: false,
    };
    const r = evaluateDrillResult(broken, { durationSeconds: 999999, rtoHours: 1 });
    assert.equal(r.result, "fail");
  });
});

describe("computeDrillOverdueStatus", () => {
  const NOW = "2026-07-14T12:00:00.000Z";

  it("vencido de inmediato si nunca se corrió (lastRunAt null)", () => {
    const r = computeDrillOverdueStatus("restore_verification", null, NOW);
    assert.equal(r.isOverdue, true);
    assert.equal(r.daysSinceLastRun, null);
  });

  it("no vencido si el último simulacro fue reciente", () => {
    const r = computeDrillOverdueStatus("restore_verification", "2026-07-01T12:00:00.000Z", NOW);
    assert.equal(r.isOverdue, false);
  });

  it("restore_verification vence a los 182 días", () => {
    const justUnder = computeDrillOverdueStatus("restore_verification", "2026-01-14T12:00:00.000Z", NOW); // 181 días
    const justOver = computeDrillOverdueStatus("restore_verification", "2026-01-13T12:00:00.000Z", NOW); // 182 días
    assert.equal(justUnder.isOverdue, false);
    assert.equal(justOver.isOverdue, true);
  });

  it("succession_simulation vence a los 365 días (anual)", () => {
    const r = computeDrillOverdueStatus("succession_simulation", "2025-07-14T12:00:00.000Z", NOW);
    assert.equal(r.isOverdue, true);
  });

  it("fallback_no_admin vence a los 91 días (trimestral) — más estricto que los demás", () => {
    const r = computeDrillOverdueStatus("fallback_no_admin", "2026-04-01T12:00:00.000Z", NOW); // ~104 días
    assert.equal(r.isOverdue, true);
  });

  it("emergency_kit_check comparte intervalo semestral con restore_verification", () => {
    const r = computeDrillOverdueStatus("emergency_kit_check", "2026-01-14T12:00:00.000Z", NOW);
    assert.equal(r.intervalDays, 182);
  });
});

describe("computeAllDrillOverdueStatuses", () => {
  const NOW = "2026-07-14T12:00:00.000Z";

  it("devuelve los 4 tipos de simulacro aunque falten datos", () => {
    const statuses = computeAllDrillOverdueStatuses({}, NOW);
    assert.equal(statuses.length, 4);
    assert.ok(statuses.every((s) => s.isOverdue === true));
  });

  it("respeta el último run provisto por tipo", () => {
    const statuses = computeAllDrillOverdueStatuses(
      { restore_verification: "2026-07-01T12:00:00.000Z" },
      NOW
    );
    const restore = statuses.find((s) => s.drillType === "restore_verification");
    assert.equal(restore?.isOverdue, false);
  });
});

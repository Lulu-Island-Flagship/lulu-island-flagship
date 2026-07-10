import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateDrillResult, type IntegrityCheckResult } from "../../src/lib/dr-drill";

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

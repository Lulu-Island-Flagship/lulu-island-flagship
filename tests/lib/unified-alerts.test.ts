import { describe, it } from "node:test";
import assert from "node:assert";
import {
  severityRank,
  sortAlertsBySeverity,
  publishUnifiedAlert,
  type UnifiedAlertSeverity,
  type UnifiedAlertsClient,
} from "../../src/lib/unified-alerts";

describe("severityRank", () => {
  it("p0_safety < p1_urgent < p2_automatic", () => {
    assert.ok(severityRank("p0_safety") < severityRank("p1_urgent"));
    assert.ok(severityRank("p1_urgent") < severityRank("p2_automatic"));
  });
});

describe("sortAlertsBySeverity", () => {
  it("ordena P0 primero, luego P1, luego P2", () => {
    const alerts = [
      { id: "a", severity: "p2_automatic" as UnifiedAlertSeverity, created_at: "2026-07-14T10:00:00Z" },
      { id: "b", severity: "p0_safety" as UnifiedAlertSeverity, created_at: "2026-07-14T09:00:00Z" },
      { id: "c", severity: "p1_urgent" as UnifiedAlertSeverity, created_at: "2026-07-14T08:00:00Z" },
    ];
    const sorted = sortAlertsBySeverity(alerts);
    assert.deepEqual(sorted.map((a) => a.id), ["b", "c", "a"]);
  });

  it("dentro de la misma severidad, ordena por más antiguo primero", () => {
    const alerts = [
      { id: "newer", severity: "p1_urgent" as UnifiedAlertSeverity, created_at: "2026-07-14T12:00:00Z" },
      { id: "older", severity: "p1_urgent" as UnifiedAlertSeverity, created_at: "2026-07-14T08:00:00Z" },
    ];
    const sorted = sortAlertsBySeverity(alerts);
    assert.deepEqual(sorted.map((a) => a.id), ["older", "newer"]);
  });

  it("no muta el arreglo original", () => {
    const alerts = [
      { id: "a", severity: "p2_automatic" as UnifiedAlertSeverity, created_at: "2026-07-14T10:00:00Z" },
      { id: "b", severity: "p0_safety" as UnifiedAlertSeverity, created_at: "2026-07-14T09:00:00Z" },
    ];
    const original = [...alerts];
    sortAlertsBySeverity(alerts);
    assert.deepEqual(alerts, original);
  });
});

describe("publishUnifiedAlert", () => {
  it("devuelve success:true cuando el insert no tiene error", async () => {
    const fakeClient: UnifiedAlertsClient = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: "x" }, error: null }),
          }),
        }),
      }),
    };
    const result = await publishUnifiedAlert(fakeClient, {
      sourceModule: "test",
      tier: "can_wait",
      severity: "p2_automatic",
      title: "Test alert",
    });
    assert.equal(result.success, true);
    assert.equal(result.error, null);
  });

  it("devuelve success:false con el mensaje de error cuando el insert falla", async () => {
    const fakeClient: UnifiedAlertsClient = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    };
    const result = await publishUnifiedAlert(fakeClient, {
      sourceModule: "test",
      tier: "respond_10min",
      severity: "p0_safety",
      title: "Test alert",
    });
    assert.equal(result.success, false);
    assert.equal(result.error, "boom");
  });
});

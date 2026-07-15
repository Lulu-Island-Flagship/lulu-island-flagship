import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeGbpItemStatus,
  computeAllGbpItemStatuses,
  isNapCheckOverdue,
  GBP_FREQUENCY_INTERVAL_DAYS,
} from "../../src/lib/gbp-checklist";

describe("computeGbpItemStatus", () => {
  it("never_done si no se ha completado nunca", () => {
    const s = computeGbpItemStatus({ itemKey: "x", frequency: "weekly", lastCompletedAt: null }, "2026-07-14T00:00:00Z");
    assert.equal(s, "never_done");
  });

  it("once nunca vence una vez completado", () => {
    const s = computeGbpItemStatus(
      { itemKey: "x", frequency: "once", lastCompletedAt: "2020-01-01T00:00:00Z" },
      "2026-07-14T00:00:00Z"
    );
    assert.equal(s, "ok");
  });

  it("weekly: ok dentro de la ventana", () => {
    const s = computeGbpItemStatus(
      { itemKey: "x", frequency: "weekly", lastCompletedAt: "2026-07-13T00:00:00Z" },
      "2026-07-14T00:00:00Z"
    );
    assert.equal(s, "ok");
  });

  it("weekly: due_soon cerca del vencimiento", () => {
    const s = computeGbpItemStatus(
      { itemKey: "x", frequency: "weekly", lastCompletedAt: "2026-07-07T01:00:00Z" },
      "2026-07-14T00:00:00Z"
    );
    assert.equal(s, "due_soon");
  });

  it("weekly: overdue pasado el intervalo", () => {
    const s = computeGbpItemStatus(
      { itemKey: "x", frequency: "weekly", lastCompletedAt: "2026-07-01T00:00:00Z" },
      "2026-07-14T00:00:00Z"
    );
    assert.equal(s, "overdue");
  });

  it("quarterly usa 91 días", () => {
    assert.equal(GBP_FREQUENCY_INTERVAL_DAYS.quarterly, 91);
  });
});

describe("computeAllGbpItemStatuses", () => {
  it("mapea status sobre una lista", () => {
    const list = computeAllGbpItemStatuses(
      [
        { itemKey: "a", frequency: "weekly", lastCompletedAt: null },
        { itemKey: "b", frequency: "once", lastCompletedAt: "2020-01-01T00:00:00Z" },
      ],
      "2026-07-14T00:00:00Z"
    );
    assert.equal(list[0].status, "never_done");
    assert.equal(list[1].status, "ok");
  });
});

describe("isNapCheckOverdue", () => {
  it("nunca revisado = overdue", () => {
    assert.equal(isNapCheckOverdue(null, "2026-07-14T00:00:00Z"), true);
  });

  it("dentro de 91 días = no overdue", () => {
    assert.equal(isNapCheckOverdue("2026-05-01T00:00:00Z", "2026-07-14T00:00:00Z"), false);
  });

  it("pasados 91 días = overdue", () => {
    assert.equal(isNapCheckOverdue("2026-01-01T00:00:00Z", "2026-07-14T00:00:00Z"), true);
  });
});

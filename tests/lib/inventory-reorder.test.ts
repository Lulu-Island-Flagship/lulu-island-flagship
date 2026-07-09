import { describe, it } from "node:test";
import assert from "node:assert";
import {
  needsReorder,
  computeReorderSuggestions,
  formatReorderReason,
  isReminderDue,
  type InventoryItemStock,
} from "../../src/lib/inventory-reorder";

const item = (over: Partial<InventoryItemStock>): InventoryItemStock => ({
  id: "1",
  name: "Desengrasante",
  currentStock: 5,
  reorderThreshold: 3,
  ...over,
});

describe("needsReorder", () => {
  it("stock por debajo del umbral necesita reposicion", () => {
    assert.equal(needsReorder(item({ currentStock: 2, reorderThreshold: 5 })), true);
  });
  it("stock igual al umbral NO necesita reposicion (umbral es el piso, no se cruza)", () => {
    assert.equal(needsReorder(item({ currentStock: 5, reorderThreshold: 5 })), false);
  });
  it("stock por encima del umbral no necesita reposicion", () => {
    assert.equal(needsReorder(item({ currentStock: 10, reorderThreshold: 5 })), false);
  });
});

describe("computeReorderSuggestions", () => {
  it("solo incluye items bajo el umbral, ordenados por mayor deficit primero", () => {
    const items = [
      item({ id: "a", name: "A", currentStock: 8, reorderThreshold: 5 }), // no reorder
      item({ id: "b", name: "B", currentStock: 1, reorderThreshold: 5 }), // deficit 4
      item({ id: "c", name: "C", currentStock: 4, reorderThreshold: 5 }), // deficit 1
    ];
    const result = computeReorderSuggestions(items);
    assert.equal(result.length, 2);
    assert.equal(result[0].itemId, "b");
    assert.equal(result[0].deficit, 4);
    assert.equal(result[1].itemId, "c");
  });
});

describe("formatReorderReason", () => {
  it("incluye nombre, stock y umbral", () => {
    const text = formatReorderReason({
      itemId: "1",
      itemName: "Desengrasante",
      currentStock: 2,
      reorderThreshold: 5,
      deficit: 3,
    });
    assert.match(text, /Desengrasante/);
    assert.match(text, /2/);
    assert.match(text, /5/);
  });
});

describe("isReminderDue", () => {
  it("antes de 48h no es momento del recordatorio", () => {
    assert.equal(isReminderDue("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z"), false);
  });
  it("a las 48h+ si es momento del recordatorio", () => {
    assert.equal(isReminderDue("2026-07-01T00:00:00Z", "2026-07-03T01:00:00Z"), true);
  });
});

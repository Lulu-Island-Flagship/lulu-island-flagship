import { describe, it } from "node:test";
import assert from "node:assert";
import { findServiceInBundle, isBundleFresh, type DayCacheBundle } from "../../src/lib/offline-day-cache";

const BUNDLE: DayCacheBundle = {
  date: "2026-07-13",
  employee: { id: "emp1", name: "Test Employee" },
  downloadedAt: "2026-07-13T13:00:00.000Z",
  services: [
    {
      orderId: "order1",
      serviceTime: "09:00",
      address: "123 Main St",
      zone: "Richmond Central",
      serviceSubtype: "regular",
      squareFeet: 1200,
      bedrooms: 2,
      bathrooms: 1,
      addonZones: [],
      myAssignedZones: null,
      keyAccess: null,
    },
  ],
  checklistsBySubtype: { regular: [] },
};

describe("findServiceInBundle", () => {
  it("returns null when bundle is null", () => {
    assert.strictEqual(findServiceInBundle(null, "order1"), null);
  });

  it("finds a service by orderId", () => {
    const found = findServiceInBundle(BUNDLE, "order1");
    assert.strictEqual(found?.address, "123 Main St");
  });

  it("returns null for an order not in the bundle (not downloaded / not assigned)", () => {
    assert.strictEqual(findServiceInBundle(BUNDLE, "unknown_order"), null);
  });
});

describe("isBundleFresh", () => {
  it("false when bundle is null", () => {
    assert.strictEqual(isBundleFresh(null, "2026-07-13"), false);
  });

  it("true when bundle date matches today", () => {
    assert.strictEqual(isBundleFresh(BUNDLE, "2026-07-13"), true);
  });

  it("false when bundle is from a previous day (stale route, must not be trusted)", () => {
    assert.strictEqual(isBundleFresh(BUNDLE, "2026-07-14"), false);
  });
});

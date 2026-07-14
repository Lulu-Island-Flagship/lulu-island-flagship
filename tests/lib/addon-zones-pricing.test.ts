import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateAddonZonesCharge, calculatePrice, type AddonZoneOption } from "../../src/lib/pricing";

const GARAGE: AddonZoneOption = { zone: "garage", zoneLabel: "Garage", timeHours: 1.0 };
const STORAGE: AddonZoneOption = { zone: "storage", zoneLabel: "Storage Room", timeHours: 0.5 };

describe("calculateAddonZonesCharge", () => {
  it("returns 0 with no zones selected", () => {
    assert.strictEqual(calculateAddonZonesCharge([GARAGE, STORAGE], [], 70), 0);
  });

  it("charges timeHours × tarifa for a selected zone", () => {
    // 1.0h × $70/hr = $70
    assert.strictEqual(calculateAddonZonesCharge([GARAGE, STORAGE], ["garage"], 70), 70);
  });

  it("sums multiple selected zones", () => {
    // (1.0 + 0.5) × $70 = $105
    assert.strictEqual(calculateAddonZonesCharge([GARAGE, STORAGE], ["garage", "storage"], 70), 105);
  });

  it("ignores selections that are not in the available list (defensa contra manipulación del cliente)", () => {
    assert.strictEqual(calculateAddonZonesCharge([GARAGE], ["garage", "fake_zone_not_offered"], 70), 70);
  });

  it("uses the current tarifa objetivo, not a hardcoded rate", () => {
    assert.strictEqual(calculateAddonZonesCharge([GARAGE], ["garage"], 100), 100);
  });
});

describe("calculatePrice with addonZonesCharge", () => {
  it("defaults to 0 (no change vs. pre-existing callers that omit the param)", () => {
    const withDefault = calculatePrice("regular", 1000, 0, "none", 2, 10, "Richmond Central");
    assert.strictEqual(withDefault.addonZonesCharge, 0);
  });

  it("adds the addon charge into subtotal/total, not just a cosmetic field", () => {
    const base = calculatePrice("regular", 1000, 0, "none", 2, 10, "Richmond Central");
    const withAddon = calculatePrice("regular", 1000, 0, "none", 2, 10, "Richmond Central", undefined, undefined, 70, undefined, 70);
    assert.strictEqual(withAddon.addonZonesCharge, 70);
    assert.strictEqual(withAddon.subtotal, base.subtotal + 70);
    assert.ok(withAddon.total > base.total);
  });

  it("never goes negative even with a malformed negative charge", () => {
    const result = calculatePrice("regular", 1000, 0, "none", 2, 10, "Richmond Central", undefined, undefined, 70, undefined, -50);
    assert.strictEqual(result.addonZonesCharge, 0);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getHHEForRange,
  getBasePrice,
  getBasePriceWithRate,
  getBasePriceTable,
  getTargetHourlyRate,
  getOrganicMultiplier,
  getRecencyMultiplier,
  calculateHold,
  calculateMarginContribution,
  marginIsBelowFloor,
  estimateLaborCost,
  SERVICE_TYPES,
  type ServiceType,
} from "../../src/lib/pricing";

describe("pricing", () => {
  describe("getHHEForRange", () => {
    it("returns correct HHE for regular service across square footage ranges", () => {
      assert.strictEqual(getHHEForRange("regular", 500), 1.5);
      assert.strictEqual(getHHEForRange("regular", 1000), 2.5);
      assert.strictEqual(getHHEForRange("regular", 2000), 4.0);
      assert.strictEqual(getHHEForRange("regular", 3000), 6.0);
      assert.strictEqual(getHHEForRange("regular", 4000), 8.0);
    });

    it("returns correct HHE for deep service across square footage ranges", () => {
      assert.strictEqual(getHHEForRange("deep", 700), 2.5);
      assert.strictEqual(getHHEForRange("deep", 1500), 4.0);
      assert.strictEqual(getHHEForRange("deep", 2500), 6.5);
      assert.strictEqual(getHHEForRange("deep", 3500), 9.0);
      assert.strictEqual(getHHEForRange("deep", 5000), 12.0);
    });

    it("returns last bucket for oversized properties", () => {
      assert.strictEqual(getHHEForRange("post_construction", 20000), 18.0);
    });
  });

  describe("getBasePrice", () => {
    it("calculates base price from HHE at $70/hr", () => {
      assert.strictEqual(getBasePrice("regular", 1000), 175); // 2.5 * 70
      assert.strictEqual(getBasePrice("deep", 1500), 280); // 4.0 * 70
      assert.strictEqual(getBasePrice("move_in_out", 2500), 560); // 8.0 * 70
    });
  });

  describe("getBasePriceWithRate", () => {
    it("recalculates base price with custom target hourly rate", () => {
      assert.strictEqual(getBasePriceWithRate("regular", 1000, 80), 200); // 2.5 * 80
      assert.strictEqual(getBasePriceWithRate("deep", 1500, 65), 260); // 4.0 * 65
    });
  });

  describe("getBasePriceTable", () => {
    it("generates complete 4x5 table from target rate", () => {
      const table = getBasePriceTable(70);
      assert.strictEqual(table.regular.length, 5);
      assert.strictEqual(table.deep[0], 175); // 2.5 * 70
      assert.strictEqual(table.post_construction[4], 1260); // 18.0 * 70
    });

    it("recalculates all 20 cells when rate changes", () => {
      const table80 = getBasePriceTable(80);
      assert.strictEqual(table80.deep[0], 200); // 2.5 * 80
      assert.strictEqual(table80.post_construction[4], 1440); // 18.0 * 80
    });
  });

  describe("getTargetHourlyRate", () => {
    it("returns rate from Supabase RPC when available", async () => {
      const mockSupabase = {
        rpc: () => ({
          single: async () => ({ data: { get_current_target_hourly_rate: 85 }, error: null }),
        }),
      };
      const rate = await getTargetHourlyRate(mockSupabase as unknown as Parameters<typeof getTargetHourlyRate>[0]);
      assert.strictEqual(rate, 85);
    });

    it("falls back to $70 when RPC fails", async () => {
      const mockSupabase = {
        rpc: () => ({
          single: async () => ({ data: null, error: new Error("fail") }),
        }),
      };
      const rate = await getTargetHourlyRate(mockSupabase as unknown as Parameters<typeof getTargetHourlyRate>[0]);
      assert.strictEqual(rate, 70);
    });
  });

  describe("getOrganicMultiplier", () => {
    it("returns 0.90x for no pets and 1-2 residents", () => {
      assert.strictEqual(getOrganicMultiplier(0, "none", 1), 0.9);
      assert.strictEqual(getOrganicMultiplier(0, "none", 2), 0.9);
    });

    it("returns 1.00x for no pets with 3+ residents", () => {
      assert.strictEqual(getOrganicMultiplier(0, "none", 3), 1.0);
      assert.strictEqual(getOrganicMultiplier(0, "none", 4), 1.0);
    });

    it("returns 1.00x for 1 short-hair pet + 2-3 residents", () => {
      assert.strictEqual(getOrganicMultiplier(1, "short_hair", 2), 1.0);
      assert.strictEqual(getOrganicMultiplier(1, "short_hair", 3), 1.0);
    });

    it("returns 1.15x for 1-2 long-hair pets + 3-4 residents", () => {
      assert.strictEqual(getOrganicMultiplier(1, "long_hair", 3), 1.15);
      assert.strictEqual(getOrganicMultiplier(2, "long_hair", 4), 1.15);
      assert.strictEqual(getOrganicMultiplier(2, "multiple", 3), 1.15);
    });

    it("returns 1.30x for 3+ pets or 5+ residents", () => {
      assert.strictEqual(getOrganicMultiplier(3, "short_hair", 2), 1.3);
      assert.strictEqual(getOrganicMultiplier(1, "long_hair", 5), 1.3);
      assert.strictEqual(getOrganicMultiplier(4, "multiple", 6), 1.3);
    });

    it("rounds uncovered cases conservatively", () => {
      // 1 short-hair pet + 4 residents: not explicit, rounds down to 1.00
      assert.strictEqual(getOrganicMultiplier(1, "short_hair", 4), 1.0);
      // 1 long-hair pet + 2 residents: not explicit, rounds down to 1.00
      assert.strictEqual(getOrganicMultiplier(1, "long_hair", 2), 1.0);
    });
  });

  describe("getRecencyMultiplier", () => {
    it("returns 0.85x for <30 days", () => {
      assert.strictEqual(getRecencyMultiplier(0), 0.85);
      assert.strictEqual(getRecencyMultiplier(29), 0.85);
    });

    it("returns 1.00x for 30-60 days", () => {
      assert.strictEqual(getRecencyMultiplier(30), 1.0);
      assert.strictEqual(getRecencyMultiplier(60), 1.0);
    });

    it("returns 1.15x for 61-90 days", () => {
      assert.strictEqual(getRecencyMultiplier(61), 1.15);
      assert.strictEqual(getRecencyMultiplier(90), 1.15);
    });

    it("returns 1.30x for >90 days", () => {
      assert.strictEqual(getRecencyMultiplier(91), 1.3);
      assert.strictEqual(getRecencyMultiplier(365), 1.3);
    });
  });

  describe("calculateHold", () => {
    it("uses formula base for small orders", () => {
      // regular <=1500 ft²: N=2 -> 70*3*2*1.1 = 462
      assert.strictEqual(calculateHold("regular", 1000, 200), 462);
    });

    it("uses 40% of total for large orders", () => {
      const total = 2000;
      const expected = Math.round(total * 0.4);
      // deep >2500 ft²: formula base = 70*3*4*1.1 = 924; 40% of 2000 = 800
      assert.strictEqual(calculateHold("deep", 3000, total), expected);
    });

    it("chooses max between formula base and 40%", () => {
      const total = 3000;
      const fortyPercent = Math.round(total * 0.4); // 1200
      const formulaBase = 70 * 3 * 4 * 1.1; // 924
      assert.strictEqual(calculateHold("move_in_out", 3000, total), Math.max(formulaBase, fortyPercent));
    });
  });

  describe("margin calculations", () => {
    it("calculates contribution margin correctly", () => {
      assert.strictEqual(calculateMarginContribution(100, 70), 0.3);
      assert.strictEqual(calculateMarginContribution(200, 150), 0.25);
    });

    it("flags margin below 15% floor", () => {
      assert.strictEqual(marginIsBelowFloor(100, 90), true); // 10% < 15%
      assert.strictEqual(marginIsBelowFloor(100, 80), false); // 20% >= 15%
    });

    it("estimates labor cost using default $25/hr", () => {
      // regular 1000 ft² = 2.5 HHE -> 2.5 * 25 = 62.5 -> 63
      assert.strictEqual(estimateLaborCost("regular", 1000), 63);
    });
  });

  describe("SERVICE_TYPES coverage", () => {
    it("includes all four service types", () => {
      const keys = SERVICE_TYPES.map((t) => t.key);
      assert.deepStrictEqual(keys.sort(), ["deep", "move_in_out", "post_construction", "regular"].sort());
    });
  });
});

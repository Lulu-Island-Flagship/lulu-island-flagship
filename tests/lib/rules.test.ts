import { describe, it } from "node:test";
import assert from "node:assert";
import {
  applyPricingRules,
  simulatePricingRules,
  detectRuleConflicts,
  type PricingRule,
  type RuleContext,
} from "@/lib/rules";

describe("applyPricingRules", () => {
  const baseContext: RuleContext = {
    zone: "Richmond",
    dayOfWeek: 3,
    isPreferredDay: true,
    serviceType: "regular",
    serviceSubtype: "regular",
    squareFeet: 1200,
    clientScore: 50,
    servicesCount: 2,
    disputesLostCount: 0,
    accountType: "b2c",
    clientType: "returning",
    zoneDemand: 50,
    organicLoad: "low",
    daysSinceCleaning: 30,
    advanceNoticeDays: 7,
  };

  it("applies an active price_add rule", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Weekend surcharge",
        conditionJson: { and: [{ field: "dayOfWeek", op: "in", value: [0, 6] }] },
        actionType: "price_add",
        actionValue: 25,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const weekendContext = { ...baseContext, dayOfWeek: 0 };
    const result = applyPricingRules(rules, weekendContext, 100, 140);
    assert.strictEqual(result.adjustment, 25);
    assert.strictEqual(result.appliedRules.length, 1);
    assert.strictEqual(result.appliedRules[0].name, "Weekend surcharge");
  });

  it("ignores inactive rules", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Inactive rule",
        conditionJson: { field: "zone", op: "==", value: "Richmond" },
        actionType: "price_add",
        actionValue: 999,
        priority: 10,
        maxApplicable: true,
        isActive: false,
      },
    ];

    const result = applyPricingRules(rules, baseContext, 100, 140);
    assert.strictEqual(result.adjustment, 0);
    assert.strictEqual(result.appliedRules.length, 0);
  });

  it("blocks when a block rule matches", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Block low score",
        conditionJson: { field: "clientScore", op: "<", value: 0 },
        actionType: "block",
        priority: 100,
        maxApplicable: true,
        isActive: true,
      },
      {
        id: "2",
        name: "Add fee",
        conditionJson: { field: "clientScore", op: "<", value: 0 },
        actionType: "price_add",
        actionValue: 50,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const result = applyPricingRules(rules, { ...baseContext, clientScore: -10 }, 100, 140);
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.appliedRules.length, 0);
  });

  it("flags for review without changing price", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Flag oversized",
        conditionJson: { field: "squareFeet", op: ">", value: 3000 },
        actionType: "flag_for_review",
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const result = applyPricingRules(rules, { ...baseContext, squareFeet: 4000 }, 100, 140);
    assert.strictEqual(result.flagged, true);
    assert.strictEqual(result.adjustment, 0);
  });

  it("applies only the highest-priority multiplier", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Multiplier 1.1",
        conditionJson: { field: "zone", op: "==", value: "Vancouver" },
        actionType: "price_multiplier",
        actionValue: 1.1,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
      {
        id: "2",
        name: "Multiplier 1.2",
        conditionJson: { field: "zone", op: "==", value: "Vancouver" },
        actionType: "price_multiplier",
        actionValue: 1.2,
        priority: 20,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const result = applyPricingRules(rules, { ...baseContext, zone: "Vancouver" }, 100, 200);
    assert.strictEqual(result.adjustment, 40); // 200 * (1.2 - 1)
    assert.strictEqual(result.appliedRules.length, 1);
    assert.strictEqual(result.appliedRules[0].actionValue, 1.2);
  });

  it("caps cumulative surcharge at +25% over subtotal", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Large weekend surcharge",
        conditionJson: { field: "dayOfWeek", op: "in", value: [0, 6] },
        actionType: "price_add",
        actionValue: 60,
        priority: 20,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const weekendContext = { ...baseContext, dayOfWeek: 0 };
    const result = applyPricingRules(rules, weekendContext, 100, 140);
    assert.strictEqual(result.adjustment, 0); // 60 > 25% of 140 (35); discarded
    assert.strictEqual(result.flagged, true);
    assert.ok(result.flagReason?.includes("+25%"));
  });

  it("stops chain when maxApplicable is false", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "First",
        conditionJson: { field: "zone", op: "==", value: "Richmond" },
        actionType: "price_add",
        actionValue: 10,
        priority: 20,
        maxApplicable: false,
        isActive: true,
      },
      {
        id: "2",
        name: "Second",
        conditionJson: { field: "zone", op: "==", value: "Richmond" },
        actionType: "price_add",
        actionValue: 5,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const result = applyPricingRules(rules, baseContext, 100, 140);
    assert.strictEqual(result.adjustment, 10);
    assert.strictEqual(result.appliedRules.length, 1);
  });
});

describe("simulatePricingRules", () => {
  it("returns final subtotals for multiple cases", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Weekend surcharge",
        conditionJson: { field: "dayOfWeek", op: "in", value: [0, 6] },
        actionType: "price_add",
        actionValue: 25,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const baseSimContext: RuleContext = {
      zone: "Richmond",
      dayOfWeek: 1,
      isPreferredDay: true,
      serviceType: "regular",
      serviceSubtype: "regular",
      squareFeet: 1200,
      clientScore: 50,
      servicesCount: 2,
      disputesLostCount: 0,
      accountType: "b2c",
      clientType: "returning",
      zoneDemand: 50,
      organicLoad: "low",
      daysSinceCleaning: 30,
      advanceNoticeDays: 7,
    };
    const cases = [
      { name: "Weekend", context: { ...baseSimContext, dayOfWeek: 0 }, basePrice: 100, subtotal: 140 },
      { name: "Weekday", context: { ...baseSimContext, dayOfWeek: 1 }, basePrice: 100, subtotal: 140 },
    ];

    const results = simulatePricingRules(rules, cases);
    assert.strictEqual(results[0].finalSubtotal, 165);
    assert.strictEqual(results[1].finalSubtotal, 140);
  });
});

describe("detectRuleConflicts", () => {
  it("detects a block rule conflicting with non-block rules on the same field", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Block low score",
        conditionJson: { field: "clientScore", op: "<", value: 0 },
        actionType: "block",
        priority: 100,
        maxApplicable: true,
        isActive: true,
      },
      {
        id: "2",
        name: "Discount low score",
        conditionJson: { field: "clientScore", op: "<", value: 10 },
        actionType: "price_multiplier",
        actionValue: 0.9,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const conflicts = detectRuleConflicts(rules);
    assert.strictEqual(conflicts.length, 1);
    assert.ok(conflicts[0].includes("Block low score"));
  });

  it("returns no conflicts for non-overlapping rules", () => {
    const rules: PricingRule[] = [
      {
        id: "1",
        name: "Weekend surcharge",
        conditionJson: { field: "dayOfWeek", op: "in", value: [0, 6] },
        actionType: "price_add",
        actionValue: 25,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
      {
        id: "2",
        name: "North Shore surcharge",
        conditionJson: { field: "zone", op: "==", value: "North Vancouver" },
        actionType: "price_add",
        actionValue: 30,
        priority: 10,
        maxApplicable: true,
        isActive: true,
      },
    ];

    const conflicts = detectRuleConflicts(rules);
    assert.strictEqual(conflicts.length, 0);
  });
});

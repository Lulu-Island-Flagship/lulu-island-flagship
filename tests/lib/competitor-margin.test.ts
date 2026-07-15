import { test } from "node:test";
import assert from "node:assert/strict";
import { compareMarginIfMatched, MARGIN_RECOMMENDATION_FLOOR_PERCENT } from "../../src/lib/competitor-tracking";

test("compareMarginIfMatched returns null for non-positive prices", () => {
  assert.equal(compareMarginIfMatched(0, 10000, 26000, "Comp A"), null);
  assert.equal(compareMarginIfMatched(28500, 10000, 0, "Comp A"), null);
});

test("compareMarginIfMatched matches the plan's literal example (maintain)", () => {
  // Lulu $285, margin 32% -> cost ~= 285*(1-0.32)=193.8 -> use 19380 cents cost
  // Comp A $260 -> margin if matched = (260-193.8)/260 = 25.5%
  const result = compareMarginIfMatched(28500, 19380, 26000, "Comp A");
  assert.ok(result);
  assert.equal(Math.round(result!.ourMarginPercent * 100), 32);
  assert.equal(result!.recommendation, "maintain");
  assert.match(result!.message, /Recommendation: maintain/);
});

test("compareMarginIfMatched recommends reconsidering below the floor", () => {
  // our cost is high enough that matching a much lower competitor price would blow through the floor
  const result = compareMarginIfMatched(28500, 24000, 26000, "Comp B");
  assert.ok(result);
  assert.ok(result!.marginIfMatchedPercent < MARGIN_RECOMMENDATION_FLOOR_PERCENT);
  assert.equal(result!.recommendation, "reconsider");
  assert.match(result!.message, /do not match/);
});

test("compareMarginIfMatched: comfortably above the floor recommends maintain", () => {
  // competitor price such that margin if matched is well above 15%
  const cost = 15000;
  const competitorPrice = 30000; // (30000-15000)/30000 = 50%
  const result = compareMarginIfMatched(28500, cost, competitorPrice, "Comp C");
  assert.ok(result);
  assert.ok(result!.marginIfMatchedPercent >= MARGIN_RECOMMENDATION_FLOOR_PERCENT);
  assert.equal(result!.recommendation, "maintain");
});

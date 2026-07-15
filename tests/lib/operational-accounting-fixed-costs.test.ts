import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProratedFixedCostsPerOrder } from "../../src/lib/operational-accounting";

test("computeProratedFixedCostsPerOrder returns 0 when there are no orders", () => {
  assert.equal(computeProratedFixedCostsPerOrder(100000, []), 0);
});

test("computeProratedFixedCostsPerOrder returns 0 when monthly fixed costs are not configured", () => {
  const dates = ["2026-07-01", "2026-07-15", "2026-07-20"];
  assert.equal(computeProratedFixedCostsPerOrder(0, dates), 0);
});

test("computeProratedFixedCostsPerOrder splits a single month evenly across its orders", () => {
  // $1000 fixed costs, 10 orders all in July -> $100/order = 10000 cents
  const dates = Array(10).fill("2026-07-15");
  assert.equal(computeProratedFixedCostsPerOrder(100000, dates), 10000);
});

test("computeProratedFixedCostsPerOrder multiplies by distinct calendar months present", () => {
  // 2 distinct months (July, August), 4 orders total -> pool = 2x monthly, split over 4
  const dates = ["2026-07-01", "2026-07-15", "2026-08-01", "2026-08-15"];
  const monthlyFixedCostsCents = 100000;
  const expected = Math.round((monthlyFixedCostsCents * 2) / 4);
  assert.equal(computeProratedFixedCostsPerOrder(monthlyFixedCostsCents, dates), expected);
});

test("computeProratedFixedCostsPerOrder never divides by zero months", () => {
  // defensive: even a malformed single date still counts as >=1 month
  const dates = ["2026-07-01"];
  assert.equal(computeProratedFixedCostsPerOrder(100000, dates), 100000);
});

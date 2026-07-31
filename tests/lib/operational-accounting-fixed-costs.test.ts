import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProratedFixedCostsPerOrder } from "../../src/lib/operational-accounting";

test("computeProratedFixedCostsPerOrder returns [] when there are no orders", () => {
  assert.deepEqual(computeProratedFixedCostsPerOrder(100000, []), []);
});

test("computeProratedFixedCostsPerOrder returns all zeros when monthly fixed costs are not configured", () => {
  const dates = ["2026-07-01", "2026-07-15", "2026-07-20"];
  assert.deepEqual(computeProratedFixedCostsPerOrder(0, dates), [0, 0, 0]);
});

test("computeProratedFixedCostsPerOrder splits a single month evenly across its orders", () => {
  // $1000 fixed costs, 10 orders all in July -> $100/order = 10000 cents each
  const dates = Array(10).fill("2026-07-15");
  const result = computeProratedFixedCostsPerOrder(100000, dates);
  assert.deepEqual(result, Array(10).fill(10000));
  assert.equal(result.reduce((a, b) => a + b, 0), 100000);
});

test("computeProratedFixedCostsPerOrder multiplies by distinct calendar months present", () => {
  // 2 distinct months (July, August), 4 orders total -> pool = 2x monthly, split over 4
  const dates = ["2026-07-01", "2026-07-15", "2026-08-01", "2026-08-15"];
  const monthlyFixedCostsCents = 100000;
  const result = computeProratedFixedCostsPerOrder(monthlyFixedCostsCents, dates);
  assert.deepEqual(result, [50000, 50000, 50000, 50000]);
  assert.equal(result.reduce((a, b) => a + b, 0), monthlyFixedCostsCents * 2);
});

test("computeProratedFixedCostsPerOrder never divides by zero months", () => {
  // defensive: even a malformed single date still counts as >=1 month
  const dates = ["2026-07-01"];
  assert.deepEqual(computeProratedFixedCostsPerOrder(100000, dates), [100000]);
});

// Regression (auditoría 2026-07-30): antes se perdía(n) centavo(s) por
// redondeo cuando el pool total no se dividía exacto entre las órdenes --
// el caller aplicaba Math.round(total/n) a cada una de las n órdenes, y
// esa suma no coincidía con el total. Ahora el array siempre suma EXACTO
// el total, repartiendo el resto de centavos entre las primeras órdenes.
test("computeProratedFixedCostsPerOrder distributes the leftover cents across the first orders instead of losing them", () => {
  // $100.00 (10000 cents), 3 orders in the same month -> 10000/3 = 3333.33...
  const dates = ["2026-07-01", "2026-07-10", "2026-07-20"];
  const result = computeProratedFixedCostsPerOrder(10000, dates);
  assert.deepEqual(result, [3334, 3333, 3333]);
  assert.equal(result.reduce((a, b) => a + b, 0), 10000);
});

test("computeProratedFixedCostsPerOrder leftover distribution scales with more remainder cents", () => {
  // $100.03 (10003 cents), 5 orders -> base 2000, remainder 3 -> first 3 orders get +1
  const dates = ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"];
  const result = computeProratedFixedCostsPerOrder(10003, dates);
  assert.deepEqual(result, [2001, 2001, 2001, 2000, 2000]);
  assert.equal(result.reduce((a, b) => a + b, 0), 10003);
});

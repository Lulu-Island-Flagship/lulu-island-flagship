import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateOvertimePay } from "../../src/lib/payroll";

test("no overtime when day is 8h or less", () => {
  const result = calculateOvertimePay({ totalDayMinutes: 480, dayRateCents: 20000 });
  assert.equal(result.overtimeMinutes, 0);
  assert.equal(result.overtimePayCents, 0);
});

test("30 min over 8h pays 1.5x the hourly-equivalent rate on the excess", () => {
  // dayRate $200 / 8h = $25/h hourly equivalent. 30 min overtime @ 1.5x = 0.5h * $25 * 1.5 = $18.75
  const result = calculateOvertimePay({ totalDayMinutes: 510, dayRateCents: 20000 });
  assert.equal(result.overtimeMinutes, 30);
  assert.equal(result.hourlyRateCents, 2500);
  assert.equal(result.overtimePayCents, 1875);
});

test("caps naturally around 2h since dispatch blocks past 10h (workday.ts), but function itself has no hard cap", () => {
  const result = calculateOvertimePay({ totalDayMinutes: 600, dayRateCents: 20000 });
  assert.equal(result.overtimeMinutes, 120);
  assert.equal(result.overtimePayCents, 7500); // 2h * $25 * 1.5
});

test("under 8h never produces negative overtime", () => {
  const result = calculateOvertimePay({ totalDayMinutes: 300, dayRateCents: 20000 });
  assert.equal(result.overtimeMinutes, 0);
  assert.equal(result.overtimePayCents, 0);
});

test("custom multiplier and standard day length are respected", () => {
  const result = calculateOvertimePay({
    totalDayMinutes: 300,
    dayRateCents: 12000,
    standardDayMinutes: 240,
    overtimeMultiplier: 2,
  });
  // hourly = 12000/(240/60) = 3000 cents/h; overtime = 60 min = 1h; pay = 1 * 3000 * 2 = 6000
  assert.equal(result.overtimeMinutes, 60);
  assert.equal(result.hourlyRateCents, 3000);
  assert.equal(result.overtimePayCents, 6000);
});

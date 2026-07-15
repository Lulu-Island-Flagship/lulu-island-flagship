import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRebookDateOptions,
  computeDayOfWeekFromDate,
  computeNextRecurringDate,
  computeBirthdayGiftEligibility,
  DEFAULT_BIRTHDAY_GIFT_CENTS,
  FREQUENCY_STEP_DAYS,
} from "../../src/lib/rebook";

test("computeRebookDateOptions returns 3 options offset from today", () => {
  const options = computeRebookDateOptions("2026-07-14");
  assert.equal(options.length, 3);
  assert.equal(options[0].date, "2026-07-21");
  assert.equal(options[1].date, "2026-07-28");
  assert.equal(options[2].date, "2026-08-13");
  for (const opt of options) {
    assert.ok(opt.label.length > 0);
  }
});

test("computeRebookDateOptions labels reflect offsets", () => {
  const options = computeRebookDateOptions("2026-01-01");
  assert.match(options[0].label, /Next week/);
  assert.match(options[1].label, /2 weeks/);
  assert.match(options[2].label, /month/);
});

test("computeDayOfWeekFromDate matches known weekday", () => {
  // 2026-07-14 is a Tuesday
  assert.equal(computeDayOfWeekFromDate("2026-07-14"), 2);
  // 2026-07-19 is a Sunday
  assert.equal(computeDayOfWeekFromDate("2026-07-19"), 0);
});

test("computeNextRecurringDate keeps a future scheduled date as-is", () => {
  const result = computeNextRecurringDate("2026-08-01", "2026-07-14", "weekly");
  assert.equal(result, "2026-08-01");
});

test("computeNextRecurringDate keeps today as valid (not past)", () => {
  const result = computeNextRecurringDate("2026-07-14", "2026-07-14", "monthly");
  assert.equal(result, "2026-07-14");
});

test("computeNextRecurringDate rolls forward a past weekly date", () => {
  // last scheduled 2026-07-01 (past), weekly steps of 7 days, today 2026-07-14
  const result = computeNextRecurringDate("2026-07-01", "2026-07-14", "weekly");
  // 07-01 -> 07-08 (still past) -> 07-15 (future)
  assert.equal(result, "2026-07-15");
});

test("computeNextRecurringDate rolls forward with biweekly/monthly/quarterly steps", () => {
  assert.equal(FREQUENCY_STEP_DAYS.biweekly, 14);
  assert.equal(FREQUENCY_STEP_DAYS.monthly, 30);
  assert.equal(FREQUENCY_STEP_DAYS.quarterly, 90);
  const result = computeNextRecurringDate("2026-01-01", "2026-07-14", "quarterly");
  assert.ok(new Date(result) > new Date("2026-07-14"));
});

test("computeNextRecurringDate handles null next_scheduled_date by rolling from today", () => {
  const result = computeNextRecurringDate(null, "2026-07-14", "weekly");
  assert.equal(result, "2026-07-14");
});

test("computeBirthdayGiftEligibility: eligible on matching month/day, no prior gift this year", () => {
  const decision = computeBirthdayGiftEligibility("1990-07-14", "2026-07-14", null);
  assert.equal(decision.eligible, true);
  assert.equal(decision.year, 2026);
});

test("computeBirthdayGiftEligibility: not eligible if already gifted this year", () => {
  const decision = computeBirthdayGiftEligibility("1990-07-14", "2026-07-14", 2026);
  assert.equal(decision.eligible, false);
});

test("computeBirthdayGiftEligibility: eligible again next year after a prior gift", () => {
  const decision = computeBirthdayGiftEligibility("1990-07-14", "2027-07-14", 2026);
  assert.equal(decision.eligible, true);
  assert.equal(decision.year, 2027);
});

test("computeBirthdayGiftEligibility: not eligible on a different day", () => {
  const decision = computeBirthdayGiftEligibility("1990-07-15", "2026-07-14", null);
  assert.equal(decision.eligible, false);
});

test("DEFAULT_BIRTHDAY_GIFT_CENTS is a sane positive fallback", () => {
  assert.ok(DEFAULT_BIRTHDAY_GIFT_CENTS > 0);
});

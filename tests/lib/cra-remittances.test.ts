import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateCppEiMonthlyPeriods,
  generateGstPstQuarterlyPeriods,
  generateT4AnnualPeriod,
  generateFullYearSchedule,
  isRemittanceOverdue,
} from "../../src/lib/cra-remittances";

test("generateCppEiMonthlyPeriods: 12 periods, each due on the 15th of the following month", () => {
  const periods = generateCppEiMonthlyPeriods(2026);
  assert.equal(periods.length, 12);
  assert.equal(periods[0].periodStartISO, "2026-01-01");
  assert.equal(periods[0].periodEndISO, "2026-01-31");
  assert.equal(periods[0].dueDateISO, "2026-02-15");
});

test("generateCppEiMonthlyPeriods: December rolls the due date into January of next year", () => {
  const periods = generateCppEiMonthlyPeriods(2026);
  const december = periods[11];
  assert.equal(december.periodEndISO, "2026-12-31");
  assert.equal(december.dueDateISO, "2027-01-15");
});

test("generateGstPstQuarterlyPeriods: 4 quarters, due one month after each closes", () => {
  const periods = generateGstPstQuarterlyPeriods(2026);
  assert.equal(periods.length, 4);
  assert.equal(periods[0].periodEndISO, "2026-03-31");
  assert.equal(periods[0].dueDateISO, "2026-04-30");
  assert.equal(periods[3].periodEndISO, "2026-12-31");
  assert.equal(periods[3].dueDateISO, "2027-01-31");
});

test("generateT4AnnualPeriod: covers the full calendar year, due end of Feb next year", () => {
  const period = generateT4AnnualPeriod(2026);
  assert.equal(period.periodStartISO, "2026-01-01");
  assert.equal(period.periodEndISO, "2026-12-31");
  assert.equal(period.dueDateISO, "2027-02-28");
});

test("generateFullYearSchedule: 12 + 4 + 1 = 17 periods", () => {
  assert.equal(generateFullYearSchedule(2026).length, 17);
});

test("isRemittanceOverdue: false once filed regardless of date", () => {
  assert.equal(isRemittanceOverdue("2026-01-01", "filed", "2026-06-01"), false);
});

test("isRemittanceOverdue: true when pending and past due date", () => {
  assert.equal(isRemittanceOverdue("2026-01-01", "pending", "2026-01-02"), true);
});

test("isRemittanceOverdue: false when pending but not yet due", () => {
  assert.equal(isRemittanceOverdue("2026-06-01", "pending", "2026-01-02"), false);
});

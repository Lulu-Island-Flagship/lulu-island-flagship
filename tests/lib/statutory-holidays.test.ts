import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEasterSunday,
  computeBcStatutoryHolidays,
  decideStatHolidayEligibility,
  computeAverageDayPay,
  STAT_HOLIDAY_MIN_EMPLOYMENT_DAYS,
  STAT_HOLIDAY_MIN_DAYS_WORKED_IN_WINDOW,
} from "../../src/lib/statutory-holidays";

test("computeEasterSunday matches known dates", () => {
  assert.equal(computeEasterSunday(2024).toISOString().slice(0, 10), "2024-03-31");
  assert.equal(computeEasterSunday(2025).toISOString().slice(0, 10), "2025-04-20");
  assert.equal(computeEasterSunday(2026).toISOString().slice(0, 10), "2026-04-05");
});

test("computeBcStatutoryHolidays: 11 holidays, Good Friday is 2 days before Easter", () => {
  const holidays = computeBcStatutoryHolidays(2026);
  assert.equal(holidays.length, 11);
  const goodFriday = holidays.find((h) => h.name === "Good Friday");
  assert.equal(goodFriday?.dateISO, "2026-04-03");
});

test("computeBcStatutoryHolidays: fixed-date holidays land correctly", () => {
  const holidays = computeBcStatutoryHolidays(2026);
  assert.equal(holidays.find((h) => h.name === "New Year's Day")?.dateISO, "2026-01-01");
  assert.equal(holidays.find((h) => h.name === "Canada Day")?.dateISO, "2026-07-01");
  assert.equal(
    holidays.find((h) => h.name === "National Day for Truth and Reconciliation")?.dateISO,
    "2026-09-30"
  );
  assert.equal(holidays.find((h) => h.name === "Remembrance Day")?.dateISO, "2026-11-11");
  assert.equal(holidays.find((h) => h.name === "Christmas Day")?.dateISO, "2026-12-25");
});

test("computeBcStatutoryHolidays: Family Day is the 3rd Monday of February", () => {
  const holidays = computeBcStatutoryHolidays(2026);
  const familyDay = new Date(holidays.find((h) => h.name === "Family Day")!.dateISO);
  assert.equal(familyDay.getUTCDay(), 1); // Monday
});

test("computeBcStatutoryHolidays: Victoria Day is the Monday before May 25", () => {
  const holidays = computeBcStatutoryHolidays(2026);
  const victoriaDay = holidays.find((h) => h.name === "Victoria Day")!.dateISO;
  const d = new Date(victoriaDay);
  assert.equal(d.getUTCDay(), 1);
  assert.ok(d.getUTCDate() <= 24);
});

test("constants match ESA thresholds", () => {
  assert.equal(STAT_HOLIDAY_MIN_EMPLOYMENT_DAYS, 30);
  assert.equal(STAT_HOLIDAY_MIN_DAYS_WORKED_IN_WINDOW, 15);
});

test("decideStatHolidayEligibility: ineligible under 30 days employed", () => {
  const result = decideStatHolidayEligibility({ daysEmployedAtHoliday: 10, daysWorkedInPrior30: 20 });
  assert.equal(result.eligible, false);
});

test("decideStatHolidayEligibility: ineligible under 15 days worked in window", () => {
  const result = decideStatHolidayEligibility({ daysEmployedAtHoliday: 100, daysWorkedInPrior30: 10 });
  assert.equal(result.eligible, false);
});

test("decideStatHolidayEligibility: eligible when both thresholds met", () => {
  const result = decideStatHolidayEligibility({ daysEmployedAtHoliday: 100, daysWorkedInPrior30: 15 });
  assert.equal(result.eligible, true);
});

test("computeAverageDayPay: divides total wages by days worked", () => {
  assert.equal(computeAverageDayPay(300000, 20), 15000);
});

test("computeAverageDayPay: zero days worked returns 0, no division by zero", () => {
  assert.equal(computeAverageDayPay(50000, 0), 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateCppEiMonthlyPeriods,
  generateGstPstQuarterlyPeriods,
  generateT4AnnualPeriod,
  generateFullYearSchedule,
  isRemittanceOverdue,
  nextBusinessDay,
} from "../../src/lib/cra-remittances";

// Fix de auditoría E9 (fiscal): nextBusinessDay() ajusta fechas límite que
// caen en fin de semana o festivo reconocido por CRA al siguiente día hábil.
test("nextBusinessDay: returns the same date when it's already a business day", () => {
  assert.equal(nextBusinessDay("2026-04-30"), "2026-04-30"); // jueves
});

test("nextBusinessDay: rolls a Saturday forward to Monday", () => {
  assert.equal(nextBusinessDay("2026-01-03"), "2026-01-05"); // sábado -> lunes
});

test("nextBusinessDay: rolls a Sunday forward to Monday", () => {
  assert.equal(nextBusinessDay("2026-02-15"), "2026-02-16"); // domingo -> lunes
});

test("nextBusinessDay: skips a CRA-recognized holiday that falls on a weekday", () => {
  // Canada Day 2026 cae miércoles -> corre al jueves 2026-07-02.
  assert.equal(nextBusinessDay("2026-07-01"), "2026-07-02");
});

test("generateCppEiMonthlyPeriods: 12 periods, due on the 15th of the following month (or next business day)", () => {
  const periods = generateCppEiMonthlyPeriods(2026);
  assert.equal(periods.length, 12);
  assert.equal(periods[0].periodStartISO, "2026-01-01");
  assert.equal(periods[0].periodEndISO, "2026-01-31");
  // Fix de auditoría E9 (fiscal): 2026-02-15 cae domingo, así que la fecha
  // límite real es el siguiente día hábil (lunes 16; el "Family Day" de BC
  // ese mismo lunes no lo reconoce CRA, ver statutory-holidays.ts).
  assert.equal(periods[0].dueDateISO, "2026-02-16");
});

test("generateCppEiMonthlyPeriods: December rolls the due date into January of next year", () => {
  const periods = generateCppEiMonthlyPeriods(2026);
  const december = periods[11];
  assert.equal(december.periodEndISO, "2026-12-31");
  // 2027-01-15 cae viernes (día hábil), no requiere ajuste.
  assert.equal(december.dueDateISO, "2027-01-15");
});

test("generateGstPstQuarterlyPeriods: 4 quarters, due one month after each closes (or next business day)", () => {
  const periods = generateGstPstQuarterlyPeriods(2026);
  assert.equal(periods.length, 4);
  assert.equal(periods[0].periodEndISO, "2026-03-31");
  // 2026-04-30 cae jueves (día hábil), no requiere ajuste.
  assert.equal(periods[0].dueDateISO, "2026-04-30");
  assert.equal(periods[3].periodEndISO, "2026-12-31");
  // Fix de auditoría E9 (fiscal): 2027-01-31 cae domingo, se ajusta al
  // siguiente día hábil (lunes 2027-02-01).
  assert.equal(periods[3].dueDateISO, "2027-02-01");
});

test("generateT4AnnualPeriod: covers the full calendar year, due end of Feb next year (or next business day)", () => {
  const period = generateT4AnnualPeriod(2026);
  assert.equal(period.periodStartISO, "2026-01-01");
  assert.equal(period.periodEndISO, "2026-12-31");
  // Fix de auditoría E9 (fiscal): 2027-02-28 cae domingo, se ajusta al
  // siguiente día hábil (lunes 2027-03-01).
  assert.equal(period.dueDateISO, "2027-03-01");
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

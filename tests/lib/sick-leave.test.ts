import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideSickLeaveEligibility,
  SICK_LEAVE_MIN_EMPLOYMENT_DAYS,
  PAID_SICK_DAYS_PER_YEAR,
  UNPAID_PROTECTED_SICK_DAYS_PER_YEAR,
} from "../../src/lib/sick-leave";

test("constants match BC ESA Part 5.1", () => {
  assert.equal(SICK_LEAVE_MIN_EMPLOYMENT_DAYS, 90);
  assert.equal(PAID_SICK_DAYS_PER_YEAR, 5);
  assert.equal(UNPAID_PROTECTED_SICK_DAYS_PER_YEAR, 3);
});

test("before 90 days employed: discretionary regardless of usage", () => {
  const result = decideSickLeaveEligibility({
    daysEmployedContinuous: 45,
    paidDaysUsedThisYear: 0,
    unpaidProtectedDaysUsedThisYear: 0,
  });
  assert.equal(result.payType, "discretionary");
});

test("after 90 days, first 5 days are paid", () => {
  const result = decideSickLeaveEligibility({
    daysEmployedContinuous: 100,
    paidDaysUsedThisYear: 2,
    unpaidProtectedDaysUsedThisYear: 0,
  });
  assert.equal(result.payType, "paid");
});

test("after exhausting 5 paid days, next 3 are unpaid but protected", () => {
  const result = decideSickLeaveEligibility({
    daysEmployedContinuous: 400,
    paidDaysUsedThisYear: 5,
    unpaidProtectedDaysUsedThisYear: 1,
  });
  assert.equal(result.payType, "unpaid_protected");
});

test("after exhausting both paid and unpaid protected days, becomes discretionary", () => {
  const result = decideSickLeaveEligibility({
    daysEmployedContinuous: 400,
    paidDaysUsedThisYear: 5,
    unpaidProtectedDaysUsedThisYear: 3,
  });
  assert.equal(result.payType, "discretionary");
});

test("boundary: exactly 90 days employed counts as eligible", () => {
  const result = decideSickLeaveEligibility({
    daysEmployedContinuous: 90,
    paidDaysUsedThisYear: 0,
    unpaidProtectedDaysUsedThisYear: 0,
  });
  assert.equal(result.payType, "paid");
});

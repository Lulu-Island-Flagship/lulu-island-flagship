import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasMinimumRestBetweenShifts,
  evaluateWeeklyRest,
  MIN_REST_BETWEEN_SHIFTS_HOURS,
  MIN_WEEKLY_CONSECUTIVE_REST_HOURS,
} from "../../src/lib/shift-rest";

test("constants match BC ESA s.32/s.35", () => {
  assert.equal(MIN_REST_BETWEEN_SHIFTS_HOURS, 8);
  assert.equal(MIN_WEEKLY_CONSECUTIVE_REST_HOURS, 32);
});

test("hasMinimumRestBetweenShifts: exactly 8h satisfies", () => {
  const result = hasMinimumRestBetweenShifts("2026-01-01T18:00:00Z", "2026-01-02T02:00:00Z");
  assert.equal(result.gapHours, 8);
  assert.equal(result.satisfiesMinimumRest, true);
});

test("hasMinimumRestBetweenShifts: less than 8h fails", () => {
  const result = hasMinimumRestBetweenShifts("2026-01-01T18:00:00Z", "2026-01-02T01:00:00Z");
  assert.equal(result.satisfiesMinimumRest, false);
});

test("evaluateWeeklyRest: 0 or 1 shifts trivially satisfies (no gap to measure)", () => {
  assert.equal(evaluateWeeklyRest([]).satisfiesWeeklyRest, true);
  assert.equal(
    evaluateWeeklyRest([{ startISO: "2026-01-01T08:00:00Z", endISO: "2026-01-01T16:00:00Z" }]).satisfiesWeeklyRest,
    true
  );
});

test("evaluateWeeklyRest: finds the longest gap among multiple shifts", () => {
  const shifts = [
    { startISO: "2026-01-01T08:00:00Z", endISO: "2026-01-01T16:00:00Z" },
    { startISO: "2026-01-02T08:00:00Z", endISO: "2026-01-02T16:00:00Z" }, // 16h gap from prev
    { startISO: "2026-01-06T08:00:00Z", endISO: "2026-01-06T16:00:00Z" }, // 112h gap from prev -> satisfies
  ];
  const result = evaluateWeeklyRest(shifts);
  assert.equal(result.satisfiesWeeklyRest, true);
  assert.ok(result.longestGapHours >= 32);
});

test("evaluateWeeklyRest: fails when no gap reaches 32h across the week", () => {
  const shifts = [
    { startISO: "2026-01-01T08:00:00Z", endISO: "2026-01-01T16:00:00Z" },
    { startISO: "2026-01-02T08:00:00Z", endISO: "2026-01-02T16:00:00Z" },
    { startISO: "2026-01-03T08:00:00Z", endISO: "2026-01-03T16:00:00Z" },
    { startISO: "2026-01-04T08:00:00Z", endISO: "2026-01-04T16:00:00Z" },
    { startISO: "2026-01-05T08:00:00Z", endISO: "2026-01-05T16:00:00Z" },
    { startISO: "2026-01-06T08:00:00Z", endISO: "2026-01-06T16:00:00Z" },
    { startISO: "2026-01-07T08:00:00Z", endISO: "2026-01-07T16:00:00Z" },
  ];
  const result = evaluateWeeklyRest(shifts);
  assert.equal(result.satisfiesWeeklyRest, false);
});

test("evaluateWeeklyRest: unsorted input still finds the correct longest gap", () => {
  const shifts = [
    { startISO: "2026-01-06T08:00:00Z", endISO: "2026-01-06T16:00:00Z" },
    { startISO: "2026-01-01T08:00:00Z", endISO: "2026-01-01T16:00:00Z" },
    { startISO: "2026-01-02T08:00:00Z", endISO: "2026-01-02T16:00:00Z" },
  ];
  const result = evaluateWeeklyRest(shifts);
  assert.equal(result.satisfiesWeeklyRest, true);
});

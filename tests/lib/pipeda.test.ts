import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRequestDueAt,
  computePurgeEligibleAt,
  computeBreachNotificationDueAt,
  isRequestOverdue,
  isBreachNotificationOverdue,
  isFeedBlind,
  computeNextQuarterlyReviewDate,
  ACCESS_REQUEST_DUE_HOURS,
  BREACH_NOTIFICATION_DUE_HOURS,
  DELETION_RETENTION_YEARS,
} from "../../src/lib/pipeda";

test("computeRequestDueAt adds 48h", () => {
  const requestedAt = new Date("2026-07-14T10:00:00Z");
  const due = computeRequestDueAt(requestedAt);
  assert.equal(ACCESS_REQUEST_DUE_HOURS, 48);
  assert.equal(due.toISOString(), "2026-07-16T10:00:00.000Z");
});

test("computePurgeEligibleAt adds 2 fiscal years", () => {
  const softDeletedAt = new Date("2026-07-14T00:00:00Z");
  const purge = computePurgeEligibleAt(softDeletedAt);
  assert.equal(DELETION_RETENTION_YEARS, 2);
  assert.equal(purge.toISOString(), "2028-07-14T00:00:00.000Z");
});

test("computeBreachNotificationDueAt adds 72h", () => {
  const detectedAt = new Date("2026-07-14T10:00:00Z");
  const due = computeBreachNotificationDueAt(detectedAt);
  assert.equal(BREACH_NOTIFICATION_DUE_HOURS, 72);
  assert.equal(due.toISOString(), "2026-07-17T10:00:00.000Z");
});

test("isRequestOverdue: false when completed even if past due", () => {
  const due = new Date("2026-07-14T10:00:00Z");
  const now = new Date("2026-07-20T10:00:00Z");
  assert.equal(isRequestOverdue(due, now, "completed"), false);
  assert.equal(isRequestOverdue(due, now, "denied"), false);
  assert.equal(isRequestOverdue(due, now, "pending"), true);
  assert.equal(isRequestOverdue(due, now, "processing"), true);
});

test("isRequestOverdue: false before due date", () => {
  const due = new Date("2026-07-20T10:00:00Z");
  const now = new Date("2026-07-14T10:00:00Z");
  assert.equal(isRequestOverdue(due, now, "pending"), false);
});

test("isBreachNotificationOverdue: false once both notified", () => {
  const due = new Date("2026-07-14T10:00:00Z");
  const now = new Date("2026-07-20T10:00:00Z");
  assert.equal(
    isBreachNotificationOverdue(due, now, new Date("2026-07-15T00:00:00Z"), new Date("2026-07-15T00:00:00Z")),
    false
  );
});

test("isBreachNotificationOverdue: true if only one side notified and past due", () => {
  const due = new Date("2026-07-14T10:00:00Z");
  const now = new Date("2026-07-20T10:00:00Z");
  assert.equal(isBreachNotificationOverdue(due, now, new Date("2026-07-15T00:00:00Z"), null), true);
});

test("isBreachNotificationOverdue: false before due even if unnotified", () => {
  const due = new Date("2026-07-20T10:00:00Z");
  const now = new Date("2026-07-14T10:00:00Z");
  assert.equal(isBreachNotificationOverdue(due, now, null, null), false);
});

test("isFeedBlind: true after 30 days without checking (simulated freeze — E9 acceptance criterion)", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const lastCheckedAt = new Date("2026-06-01T00:00:00Z");
  const now = new Date("2026-07-02T00:00:00Z"); // 31 days after last check
  assert.equal(isFeedBlind(lastCheckedAt, createdAt, now), true);
});

test("isFeedBlind: false within 30 days", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const lastCheckedAt = new Date("2026-06-01T00:00:00Z");
  const now = new Date("2026-06-25T00:00:00Z");
  assert.equal(isFeedBlind(lastCheckedAt, createdAt, now), false);
});

test("isFeedBlind: never-checked feed uses createdAt as reference", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const now = new Date("2026-02-05T00:00:00Z"); // 35 days since creation
  assert.equal(isFeedBlind(null, createdAt, now), true);
});

test("computeNextQuarterlyReviewDate adds 3 months", () => {
  const from = new Date("2026-07-14T00:00:00Z");
  const next = computeNextQuarterlyReviewDate(from);
  assert.equal(next.toISOString(), "2026-10-14T00:00:00.000Z");
});

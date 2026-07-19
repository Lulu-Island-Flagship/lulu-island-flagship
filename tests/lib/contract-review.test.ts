import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isContractReviewDue,
  wasReviewAlreadyTriggeredForAnniversary,
  summarizeLegalChangesForReview,
  diffContractTerms,
  CONTRACT_REVIEW_LEAD_DAYS,
} from "../../src/lib/contract-review";

test("CONTRACT_REVIEW_LEAD_DAYS is 60 per spec", () => {
  assert.equal(CONTRACT_REVIEW_LEAD_DAYS, 60);
});

test("isContractReviewDue: true exactly 60 days before this year's anniversary", () => {
  // Contract started 2024-06-01 -> anniversary 2026-06-01 -> trigger 2026-04-02
  assert.equal(isContractReviewDue("2024-06-01", "2026-04-02"), true);
});

test("isContractReviewDue: false on other days", () => {
  assert.equal(isContractReviewDue("2024-06-01", "2026-04-01"), false);
  assert.equal(isContractReviewDue("2024-06-01", "2026-06-01"), false);
});

test("isContractReviewDue: rolls to next year's anniversary if this year's already passed", () => {
  // Today is after this year's June 1 anniversary -> should use NEXT year's anniversary (2027-06-01), trigger 2027-04-02
  assert.equal(isContractReviewDue("2024-06-01", "2027-04-02"), true);
});

test("isContractReviewDue: true anywhere inside the 60-day window, not just the exact day (bug fix)", () => {
  // Anniversary 2026-06-01 -> window is (2026-04-02, 2026-06-01) exclusive of anniversary itself
  assert.equal(isContractReviewDue("2024-06-01", "2026-04-03"), true); // 59 days before
  assert.equal(isContractReviewDue("2024-06-01", "2026-05-31"), true); // 1 day before
  assert.equal(isContractReviewDue("2024-06-01", "2026-03-31"), false); // 62 days before -> outside
});

test("wasReviewAlreadyTriggeredForAnniversary: false when never triggered", () => {
  assert.equal(wasReviewAlreadyTriggeredForAnniversary("2024-06-01", "2026-04-02", null), false);
});

test("wasReviewAlreadyTriggeredForAnniversary: true when already triggered for the same target anniversary", () => {
  assert.equal(wasReviewAlreadyTriggeredForAnniversary("2024-06-01", "2026-04-02", "2026-06-01"), true);
});

test("wasReviewAlreadyTriggeredForAnniversary: false when triggered for a DIFFERENT (past) anniversary", () => {
  assert.equal(wasReviewAlreadyTriggeredForAnniversary("2024-06-01", "2026-04-02", "2025-06-01"), false);
});

test("summarizeLegalChangesForReview: no changes", () => {
  const summary = summarizeLegalChangesForReview([]);
  assert.equal(summary.hasChanges, false);
  assert.equal(summary.count, 0);
});

test("summarizeLegalChangesForReview: lists descriptions", () => {
  const summary = summarizeLegalChangesForReview([
    { alertId: "a1", changeDescription: "Minimum wage increased", detectedAtISO: "2026-01-01" },
    { alertId: "a2", changeDescription: "PIPEDA breach rule updated", detectedAtISO: "2026-02-01" },
  ]);
  assert.equal(summary.hasChanges, true);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.descriptions, ["Minimum wage increased", "PIPEDA breach rule updated"]);
});

test("diffContractTerms: detects only changed fields", () => {
  const previous = { frequency: "biweekly", basePrice: 20000, total: 22400, serviceSubtype: "deep" };
  const proposed = { frequency: "biweekly", basePrice: 21000, total: 23520, serviceSubtype: "deep" };
  const diffs = diffContractTerms(previous, proposed);
  assert.equal(diffs.length, 2);
  assert.deepEqual(
    diffs.map((d) => d.field),
    ["basePrice", "total"]
  );
});

test("diffContractTerms: empty when nothing changed", () => {
  const terms = { frequency: "weekly", basePrice: 15000, total: 16800, serviceSubtype: "standard" };
  assert.equal(diffContractTerms(terms, terms).length, 0);
});

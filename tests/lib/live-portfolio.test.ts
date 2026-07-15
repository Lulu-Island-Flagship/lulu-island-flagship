import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideCandidateEligibility,
  computeWithdrawalDeadline,
  isWithdrawalWindowOpen,
  buildAnonymousLabel,
  LIVE_PORTFOLIO_MIN_CHECKLIST_PERCENT,
  LIVE_PORTFOLIO_MIN_EMPLOYEE_SCORE,
  WITHDRAWAL_WINDOW_HOURS,
} from "../../src/lib/live-portfolio";

const BASE_INPUT = {
  checklistCompletionPercent: 100,
  hasActiveFlags: false,
  employeeScore: 85,
  hasPhotoMarketingConsent: true,
};

test("decideCandidateEligibility passes when all criteria are met", () => {
  const decision = decideCandidateEligibility(BASE_INPUT);
  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.reasons, []);
});

test("decideCandidateEligibility: no consent is an absolute disqualifier ('solo fotos demo')", () => {
  const decision = decideCandidateEligibility({ ...BASE_INPUT, hasPhotoMarketingConsent: false });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes("no_photo_marketing_consent"));
});

test("decideCandidateEligibility: incomplete checklist disqualifies", () => {
  const decision = decideCandidateEligibility({ ...BASE_INPUT, checklistCompletionPercent: 99 });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes("checklist_incomplete"));
});

test("decideCandidateEligibility: active flags disqualify", () => {
  const decision = decideCandidateEligibility({ ...BASE_INPUT, hasActiveFlags: true });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes("has_active_flags"));
});

test("decideCandidateEligibility: employee score below threshold disqualifies", () => {
  const decision = decideCandidateEligibility({ ...BASE_INPUT, employeeScore: 79 });
  assert.equal(decision.eligible, false);
  assert.ok(decision.reasons.includes("employee_score_below_threshold"));
});

test("decideCandidateEligibility: score exactly at threshold passes (>=80)", () => {
  const decision = decideCandidateEligibility({ ...BASE_INPUT, employeeScore: 80 });
  assert.equal(decision.eligible, true);
});

test("decideCandidateEligibility: accumulates multiple reasons", () => {
  const decision = decideCandidateEligibility({
    checklistCompletionPercent: 50,
    hasActiveFlags: true,
    employeeScore: 10,
    hasPhotoMarketingConsent: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reasons.length, 4);
});

test("thresholds match spec", () => {
  assert.equal(LIVE_PORTFOLIO_MIN_CHECKLIST_PERCENT, 100);
  assert.equal(LIVE_PORTFOLIO_MIN_EMPLOYEE_SCORE, 80);
  assert.equal(WITHDRAWAL_WINDOW_HOURS, 24);
});

test("computeWithdrawalDeadline adds 24 hours", () => {
  const deadline = computeWithdrawalDeadline("2026-07-14T10:00:00.000Z");
  assert.equal(deadline, "2026-07-15T10:00:00.000Z");
});

test("isWithdrawalWindowOpen is true before the deadline and false after", () => {
  const approvedAt = "2026-07-14T10:00:00.000Z";
  assert.equal(isWithdrawalWindowOpen(approvedAt, "2026-07-14T20:00:00.000Z"), true);
  assert.equal(isWithdrawalWindowOpen(approvedAt, "2026-07-15T11:00:00.000Z"), false);
  assert.equal(isWithdrawalWindowOpen(approvedAt, "2026-07-15T10:00:00.000Z"), false);
});

test("buildAnonymousLabel formats zone + readable service subtype, no PII", () => {
  assert.equal(buildAnonymousLabel("Richmond", "move_in_out"), "Richmond · Move In Out");
  assert.equal(buildAnonymousLabel("Steveston", "deep_clean"), "Steveston · Deep Clean");
});

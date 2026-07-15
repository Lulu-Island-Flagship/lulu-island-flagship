import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePhotoRetentionDeadline,
  isPastRetentionDeadline,
  decideOrderPhotoPurge,
  QC_PHOTO_RETENTION_DAYS,
  DISPUTE_PHOTO_RETENTION_DAYS,
} from "../../src/lib/photo-retention";

test("retention windows match spec (1yr QC, 2yr dispute)", () => {
  assert.equal(QC_PHOTO_RETENTION_DAYS, 365);
  assert.equal(DISPUTE_PHOTO_RETENTION_DAYS, 730);
});

test("computePhotoRetentionDeadline adds the right number of days per category", () => {
  const qcDeadline = computePhotoRetentionDeadline("qc", "2025-01-01T00:00:00.000Z");
  assert.equal(qcDeadline.slice(0, 10), "2026-01-01");

  const disputeDeadline = computePhotoRetentionDeadline("dispute", "2025-01-01T00:00:00.000Z");
  assert.equal(disputeDeadline.slice(0, 10), "2027-01-01");
});

test("isPastRetentionDeadline is inclusive of the exact deadline", () => {
  assert.equal(isPastRetentionDeadline("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"), true);
  assert.equal(isPastRetentionDeadline("2026-01-01T00:00:00.000Z", "2025-12-31T23:59:59.000Z"), false);
});

test("decideOrderPhotoPurge: no claims ever -> QC category, purged after 1 year", () => {
  const noClaims = { hasAnyClaim: false, hasUnresolvedClaim: false, latestResolvedAtISO: null };
  const decision = decideOrderPhotoPurge("2024-01-01", noClaims, "2025-01-02");
  assert.equal(decision.category, "qc");
  assert.equal(decision.eligible, true);
});

test("decideOrderPhotoPurge: no claims ever, still within 1 year -> not eligible", () => {
  const noClaims = { hasAnyClaim: false, hasUnresolvedClaim: false, latestResolvedAtISO: null };
  const decision = decideOrderPhotoPurge("2024-06-01", noClaims, "2025-01-02");
  assert.equal(decision.eligible, false);
});

test("decideOrderPhotoPurge: unresolved claim never purges regardless of age", () => {
  const unresolved = { hasAnyClaim: true, hasUnresolvedClaim: true, latestResolvedAtISO: null };
  const decision = decideOrderPhotoPurge("2015-01-01", unresolved, "2030-01-01");
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "unresolved_dispute_never_purge");
});

test("decideOrderPhotoPurge: resolved claim uses dispute category, 2 years from resolution", () => {
  const resolved = {
    hasAnyClaim: true,
    hasUnresolvedClaim: false,
    latestResolvedAtISO: "2023-01-01T00:00:00.000Z",
  };
  const notYet = decideOrderPhotoPurge("2022-01-01", resolved, "2024-06-01");
  assert.equal(notYet.category, "dispute");
  assert.equal(notYet.eligible, false);

  const now = decideOrderPhotoPurge("2022-01-01", resolved, "2025-01-02");
  assert.equal(now.eligible, true);
});

test("decideOrderPhotoPurge: resolved claim missing resolved_at is a safe no-op, never purged", () => {
  const malformed = { hasAnyClaim: true, hasUnresolvedClaim: false, latestResolvedAtISO: null };
  const decision = decideOrderPhotoPurge("2020-01-01", malformed, "2030-01-01");
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "resolved_claim_missing_resolved_at");
});

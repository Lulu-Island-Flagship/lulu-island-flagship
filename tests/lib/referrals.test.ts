import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEligibleForReferralCode,
  REFERRAL_VIP_MIN_SERVICES,
  REFERRAL_VIP_MIN_SCORE,
  buildReferralCodeCandidate,
  normalizeReferralCode,
  decideSameIpFraudFlag,
  decideReferralRedemptionAttempt,
  computeReferralBanExpiry,
  isReferralBanActive,
  REFERRAL_CREDIT_CENTS,
  LEADER_MENTION_BONUS_CENTS,
  REFERRAL_MAX_DISTINCT_CODES_BEFORE_BAN,
} from "../../src/lib/referrals";

test("isEligibleForReferralCode requires STRICTLY more than 5 services and 80 score", () => {
  assert.equal(isEligibleForReferralCode(5, 81), false); // exactly 5 -- not enough
  assert.equal(isEligibleForReferralCode(6, 80), false); // exactly 80 -- not enough
  assert.equal(isEligibleForReferralCode(6, 81), true);
  assert.equal(isEligibleForReferralCode(100, 100), true);
  assert.equal(isEligibleForReferralCode(0, 100), false);
});

test("REFERRAL_VIP thresholds match spec", () => {
  assert.equal(REFERRAL_VIP_MIN_SERVICES, 5);
  assert.equal(REFERRAL_VIP_MIN_SCORE, 80);
});

test("buildReferralCodeCandidate builds a readable uppercase code", () => {
  const code = buildReferralCodeCandidate("María Pérez", "ab12cd");
  assert.match(code, /^[A-Z0-9]+-[A-Z0-9]{1,4}$/);
});

test("buildReferralCodeCandidate falls back to LULU for empty/symbol-only names", () => {
  const code = buildReferralCodeCandidate("!!!", "xyz9");
  assert.match(code, /^LULU-/);
});

test("normalizeReferralCode trims and uppercases", () => {
  assert.equal(normalizeReferralCode("  abc123  "), "ABC123");
});

test("decideSameIpFraudFlag flags identical known IPs", () => {
  assert.equal(decideSameIpFraudFlag("1.2.3.4", "1.2.3.4"), true);
  assert.equal(decideSameIpFraudFlag("1.2.3.4", "5.6.7.8"), false);
});

test("decideSameIpFraudFlag never flags null or 'unknown' IPs", () => {
  assert.equal(decideSameIpFraudFlag(null, "1.2.3.4"), false);
  assert.equal(decideSameIpFraudFlag("unknown", "unknown"), false);
});

test("decideReferralRedemptionAttempt allows first two distinct codes", () => {
  const first = decideReferralRedemptionAttempt([], "AAA-111");
  assert.equal(first.allowed, true);
  assert.equal(first.distinctCodesCount, 1);

  const second = decideReferralRedemptionAttempt(["AAA-111"], "BBB-222");
  assert.equal(second.allowed, true);
  assert.equal(second.distinctCodesCount, 2);
});

test("decideReferralRedemptionAttempt bans on the 3rd distinct code", () => {
  const decision = decideReferralRedemptionAttempt(["AAA-111", "BBB-222"], "CCC-333");
  assert.equal(decision.allowed, false);
  assert.equal(decision.banned, true);
  assert.equal(decision.distinctCodesCount, REFERRAL_MAX_DISTINCT_CODES_BEFORE_BAN);
  assert.ok(decision.reason);
});

test("decideReferralRedemptionAttempt does not double-count the same code re-tried", () => {
  const decision = decideReferralRedemptionAttempt(["AAA-111", "AAA-111"], "aaa-111");
  assert.equal(decision.allowed, true);
  assert.equal(decision.distinctCodesCount, 1);
});

test("computeReferralBanExpiry adds 30 days", () => {
  const expiry = computeReferralBanExpiry("2026-07-14T00:00:00.000Z");
  assert.equal(expiry.slice(0, 10), "2026-08-13");
});

test("isReferralBanActive respects expiry", () => {
  assert.equal(isReferralBanActive("2026-08-13T00:00:00.000Z", "2026-07-14T00:00:00.000Z"), true);
  assert.equal(isReferralBanActive("2026-06-01T00:00:00.000Z", "2026-07-14T00:00:00.000Z"), false);
  assert.equal(isReferralBanActive(null, "2026-07-14T00:00:00.000Z"), false);
});

test("credit amounts match spec ($30 both, $5 leader)", () => {
  assert.equal(REFERRAL_CREDIT_CENTS, 3000);
  assert.equal(LEADER_MENTION_BONUS_CENTS, 500);
});

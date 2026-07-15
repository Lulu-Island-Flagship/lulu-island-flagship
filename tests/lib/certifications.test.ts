import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCertificationStatus,
  isEmployeeAssignableByCertification,
  highestValidCertificationLevel,
} from "../../src/lib/certifications";

test("computeCertificationStatus: none when no record", () => {
  assert.equal(computeCertificationStatus(null, "2026-01-01"), "none");
});

test("computeCertificationStatus: revoked takes priority over dates", () => {
  const r = { level: 2 as const, expiresAtISO: "2030-01-01", revokedAtISO: "2025-06-01" };
  assert.equal(computeCertificationStatus(r, "2026-01-01"), "revoked");
});

test("computeCertificationStatus: expired once past the date", () => {
  const r = { level: 1 as const, expiresAtISO: "2025-01-01", revokedAtISO: null };
  assert.equal(computeCertificationStatus(r, "2025-01-02"), "expired");
});

test("computeCertificationStatus: expiring_soon within 30 days of expiry", () => {
  const r = { level: 1 as const, expiresAtISO: "2026-02-01", revokedAtISO: null };
  assert.equal(computeCertificationStatus(r, "2026-01-15"), "expiring_soon");
});

test("computeCertificationStatus: valid well before expiry", () => {
  const r = { level: 1 as const, expiresAtISO: "2027-01-01", revokedAtISO: null };
  assert.equal(computeCertificationStatus(r, "2026-01-01"), "valid");
});

test("isEmployeeAssignableByCertification: false with zero records", () => {
  assert.equal(isEmployeeAssignableByCertification([], "2026-01-01"), false);
});

test("isEmployeeAssignableByCertification: false when only record is expired", () => {
  const records = [{ level: 1 as const, expiresAtISO: "2025-01-01", revokedAtISO: null }];
  assert.equal(isEmployeeAssignableByCertification(records, "2026-01-01"), false);
});

test("isEmployeeAssignableByCertification: true when at least one record is valid", () => {
  const records = [
    { level: 1 as const, expiresAtISO: "2025-01-01", revokedAtISO: null },
    { level: 2 as const, expiresAtISO: "2027-01-01", revokedAtISO: null },
  ];
  assert.equal(isEmployeeAssignableByCertification(records, "2026-01-01"), true);
});

test("highestValidCertificationLevel: picks the max among currently-valid records", () => {
  const records = [
    { level: 3 as const, expiresAtISO: "2025-01-01", revokedAtISO: null }, // expired, ignored
    { level: 1 as const, expiresAtISO: "2027-01-01", revokedAtISO: null },
    { level: 2 as const, expiresAtISO: "2027-01-01", revokedAtISO: null },
  ];
  assert.equal(highestValidCertificationLevel(records, "2026-01-01"), 2);
});

test("highestValidCertificationLevel: null when nothing valid", () => {
  const records = [{ level: 3 as const, expiresAtISO: "2025-01-01", revokedAtISO: null }];
  assert.equal(highestValidCertificationLevel(records, "2026-01-01"), null);
});

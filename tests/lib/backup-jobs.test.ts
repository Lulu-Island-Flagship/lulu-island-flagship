import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBackupDueStatus,
  buildDeterministicCsv,
  computeSha256Hex,
  BACKUP_REQUIRED_INTERVAL_DAYS,
} from "../../src/lib/backup-jobs";

test("required intervals match the plan (daily/per-cycle/weekly/monthly)", () => {
  assert.equal(BACKUP_REQUIRED_INTERVAL_DAYS.transactions_daily, 1);
  assert.equal(BACKUP_REQUIRED_INTERVAL_DAYS.payroll_per_cycle, 14);
  assert.equal(BACKUP_REQUIRED_INTERVAL_DAYS.clients_weekly, 7);
  assert.equal(BACKUP_REQUIRED_INTERVAL_DAYS.photos_monthly, 30);
  assert.equal(BACKUP_REQUIRED_INTERVAL_DAYS.pg_dump_monthly, 30);
});

test("computeBackupDueStatus: due immediately if never run", () => {
  const status = computeBackupDueStatus("transactions_daily", null, "2026-01-02");
  assert.equal(status.due, true);
  assert.equal(status.lastSuccessfulRunAt, null);
});

test("computeBackupDueStatus: not due before the interval elapses", () => {
  const status = computeBackupDueStatus("clients_weekly", "2026-01-01", "2026-01-05");
  assert.equal(status.due, false);
});

test("computeBackupDueStatus: due once the interval has elapsed", () => {
  const status = computeBackupDueStatus("clients_weekly", "2026-01-01", "2026-01-08");
  assert.equal(status.due, true);
});

test("buildDeterministicCsv: quotes values containing commas or quotes", () => {
  const csv = buildDeterministicCsv(
    ["id", "note"],
    [[1, 'has, a comma'], [2, 'has "quotes"']]
  );
  assert.equal(csv, 'id,note\n1,"has, a comma"\n2,"has ""quotes"""');
});

test("buildDeterministicCsv: null becomes empty field", () => {
  const csv = buildDeterministicCsv(["id", "note"], [[1, null]]);
  assert.equal(csv, "id,note\n1,");
});

test("computeSha256Hex: deterministic for identical content", () => {
  const a = computeSha256Hex("hello world");
  const b = computeSha256Hex("hello world");
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test("computeSha256Hex: different content produces different hash", () => {
  assert.notEqual(computeSha256Hex("a"), computeSha256Hex("b"));
});

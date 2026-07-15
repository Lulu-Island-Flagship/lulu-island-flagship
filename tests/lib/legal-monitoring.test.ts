import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFeedOverdueForFrequency,
  computeRowHash,
  verifyHashChain,
  FEED_FREQUENCY_DAYS,
} from "../../src/lib/legal-monitoring";

test("FEED_FREQUENCY_DAYS matches plan declaration", () => {
  assert.equal(FEED_FREQUENCY_DAYS.daily, 1);
  assert.equal(FEED_FREQUENCY_DAYS.weekly, 7);
  assert.equal(FEED_FREQUENCY_DAYS.monthly, 30);
});

test("isFeedOverdueForFrequency: daily feed overdue after 2 days", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const lastCheckedAt = new Date("2026-07-10T00:00:00Z");
  const now = new Date("2026-07-12T01:00:00Z");
  assert.equal(isFeedOverdueForFrequency(lastCheckedAt, createdAt, now, "daily"), true);
});

test("isFeedOverdueForFrequency: weekly feed not overdue within 7 days", () => {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  const lastCheckedAt = new Date("2026-07-10T00:00:00Z");
  const now = new Date("2026-07-15T00:00:00Z");
  assert.equal(isFeedOverdueForFrequency(lastCheckedAt, createdAt, now, "weekly"), false);
});

test("computeRowHash is deterministic and depends on prevHash", () => {
  const h1 = computeRowHash({ prevHash: null, content: "breach A" });
  const h2 = computeRowHash({ prevHash: null, content: "breach A" });
  const h3 = computeRowHash({ prevHash: "seed", content: "breach A" });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test("verifyHashChain: valid chain passes", () => {
  const h0 = computeRowHash({ prevHash: null, content: "row0" });
  const h1 = computeRowHash({ prevHash: h0, content: "row1" });
  const rows = [
    { prevHash: null, content: "row0", rowHash: h0 },
    { prevHash: h0, content: "row1", rowHash: h1 },
  ];
  const result = verifyHashChain(rows);
  assert.equal(result.valid, true);
  assert.equal(result.brokenAtIndex, null);
});

test("verifyHashChain: detects tampered content", () => {
  const h0 = computeRowHash({ prevHash: null, content: "row0" });
  const h1 = computeRowHash({ prevHash: h0, content: "row1" });
  const rows = [
    { prevHash: null, content: "row0-TAMPERED", rowHash: h0 },
    { prevHash: h0, content: "row1", rowHash: h1 },
  ];
  const result = verifyHashChain(rows);
  assert.equal(result.valid, false);
  assert.equal(result.brokenAtIndex, 0);
});

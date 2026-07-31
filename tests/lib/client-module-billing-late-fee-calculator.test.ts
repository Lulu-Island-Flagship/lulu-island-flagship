import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isInvoiceOverdue,
  calculateLateFeeCents,
} from "../../src/lib/client-module/late-fee-calculator";

// ---------------------------------------------------------------------------
// isInvoiceOverdue
// ---------------------------------------------------------------------------

test("isInvoiceOverdue: true when referenceDate is after dueDate and status is not paid/void", () => {
  const dueDate = new Date("2026-07-01T00:00:00Z");
  const referenceDate = new Date("2026-07-15T00:00:00Z");
  assert.equal(isInvoiceOverdue(dueDate, referenceDate, "pending"), true);
});

test("isInvoiceOverdue: false when referenceDate is before dueDate", () => {
  const dueDate = new Date("2026-08-01T00:00:00Z");
  const referenceDate = new Date("2026-07-15T00:00:00Z");
  assert.equal(isInvoiceOverdue(dueDate, referenceDate, "pending"), false);
});

test("isInvoiceOverdue: false when referenceDate equals dueDate exactly", () => {
  const dueDate = new Date("2026-07-15T00:00:00Z");
  const referenceDate = new Date("2026-07-15T00:00:00Z");
  assert.equal(isInvoiceOverdue(dueDate, referenceDate, "pending"), false);
});

test("isInvoiceOverdue: never true for status 'paid', even if the date has passed", () => {
  const dueDate = new Date("2026-07-01T00:00:00Z");
  const referenceDate = new Date("2026-07-30T00:00:00Z");
  assert.equal(isInvoiceOverdue(dueDate, referenceDate, "paid"), false);
});

test("isInvoiceOverdue: never true for status 'void', even if the date has passed", () => {
  const dueDate = new Date("2026-07-01T00:00:00Z");
  const referenceDate = new Date("2026-07-30T00:00:00Z");
  assert.equal(isInvoiceOverdue(dueDate, referenceDate, "void"), false);
});

test("isInvoiceOverdue: true for other in-progress statuses (e.g. partially_paid) once past due", () => {
  const dueDate = new Date("2026-07-01T00:00:00Z");
  const referenceDate = new Date("2026-07-30T00:00:00Z");
  assert.equal(
    isInvoiceOverdue(dueDate, referenceDate, "partially_paid"),
    true
  );
});

// ---------------------------------------------------------------------------
// calculateLateFeeCents
// ---------------------------------------------------------------------------

test("calculateLateFeeCents: computes percentage of balance due", () => {
  assert.equal(calculateLateFeeCents(10000, 0.015), 150);
});

test("calculateLateFeeCents: works with different percentages", () => {
  assert.equal(calculateLateFeeCents(20000, 0.05), 1000);
});

test("calculateLateFeeCents: zero percentage produces zero fee", () => {
  assert.equal(calculateLateFeeCents(10000, 0), 0);
});

test("calculateLateFeeCents: zero balance produces zero fee regardless of percentage", () => {
  assert.equal(calculateLateFeeCents(0, 0.015), 0);
});

test("calculateLateFeeCents: rounds to the nearest cent", () => {
  // 3333 * 0.015 = 49.995 -> rounds to 50
  assert.equal(calculateLateFeeCents(3333, 0.015), 50);
});

test("calculateLateFeeCents: rounds down when the fractional part is below .5", () => {
  // 100 * 0.014 = 1.4 -> rounds to 1
  assert.equal(calculateLateFeeCents(100, 0.014), 1);
});

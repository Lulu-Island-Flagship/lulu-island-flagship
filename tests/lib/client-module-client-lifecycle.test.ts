import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_STATUS_TRANSITIONS,
  canTransition,
  assertValidTransition,
  InvalidStatusTransitionError,
} from "../../src/lib/client-module/client-lifecycle";
import type { ClientStatus } from "../../src/lib/client-module/types";

const ALL_STATUSES: ClientStatus[] = [
  "lead",
  "onboarding",
  "active",
  "suspended",
  "inactive",
  "churned",
];

test("CLIENT_STATUS_TRANSITIONS has an entry for every ClientStatus", () => {
  for (const status of ALL_STATUSES) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CLIENT_STATUS_TRANSITIONS, status),
      `missing transitions entry for "${status}"`
    );
  }
});

test("churned is terminal: no outgoing transitions allowed", () => {
  assert.deepEqual(CLIENT_STATUS_TRANSITIONS.churned, []);
  for (const to of ALL_STATUSES) {
    assert.equal(canTransition("churned", to), false);
  }
});

test("lead -> onboarding is valid", () => {
  assert.equal(canTransition("lead", "onboarding"), true);
});

test("lead -> churned is valid", () => {
  assert.equal(canTransition("lead", "churned"), true);
});

test("lead -> active is invalid (must go through onboarding)", () => {
  assert.equal(canTransition("lead", "active"), false);
});

test("onboarding -> active is valid", () => {
  assert.equal(canTransition("onboarding", "active"), true);
});

test("onboarding -> churned is valid", () => {
  assert.equal(canTransition("onboarding", "churned"), true);
});

test("onboarding -> suspended is invalid", () => {
  assert.equal(canTransition("onboarding", "suspended"), false);
});

test("active -> suspended is valid", () => {
  assert.equal(canTransition("active", "suspended"), true);
});

test("active -> inactive is valid", () => {
  assert.equal(canTransition("active", "inactive"), true);
});

test("active -> churned is valid", () => {
  assert.equal(canTransition("active", "churned"), true);
});

test("active -> lead is invalid", () => {
  assert.equal(canTransition("active", "lead"), false);
});

test("active -> onboarding is invalid", () => {
  assert.equal(canTransition("active", "onboarding"), false);
});

test("suspended -> active is valid", () => {
  assert.equal(canTransition("suspended", "active"), true);
});

test("suspended -> churned is valid", () => {
  assert.equal(canTransition("suspended", "churned"), true);
});

test("suspended -> inactive is invalid", () => {
  assert.equal(canTransition("suspended", "inactive"), false);
});

test("inactive -> active is valid", () => {
  assert.equal(canTransition("inactive", "active"), true);
});

test("inactive -> churned is valid", () => {
  assert.equal(canTransition("inactive", "churned"), true);
});

test("inactive -> suspended is invalid", () => {
  assert.equal(canTransition("inactive", "suspended"), false);
});

test("no status can transition to itself unless explicitly listed", () => {
  for (const status of ALL_STATUSES) {
    const allowed = CLIENT_STATUS_TRANSITIONS[status];
    assert.equal(
      allowed.includes(status),
      false,
      `"${status}" should not self-transition`
    );
  }
});

test("assertValidTransition does not throw for a valid transition", () => {
  assert.doesNotThrow(() => assertValidTransition("lead", "onboarding"));
});

test("assertValidTransition throws InvalidStatusTransitionError for an invalid transition", () => {
  assert.throws(
    () => assertValidTransition("churned", "active"),
    InvalidStatusTransitionError
  );
});

test("InvalidStatusTransitionError carries from/to and a descriptive message", () => {
  try {
    assertValidTransition("lead", "active");
    assert.fail("expected assertValidTransition to throw");
  } catch (err) {
    assert.ok(err instanceof InvalidStatusTransitionError);
    assert.equal((err as InvalidStatusTransitionError).from, "lead");
    assert.equal((err as InvalidStatusTransitionError).to, "active");
    assert.match((err as Error).message, /lead/);
    assert.match((err as Error).message, /active/);
  }
});

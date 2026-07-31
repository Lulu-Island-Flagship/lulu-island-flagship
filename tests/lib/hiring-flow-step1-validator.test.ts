import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateStep1,
  isStep1Valid,
  MIN_AGE_YEARS,
  type Step1Input,
} from "../../src/lib/hiring-flow/step1-validator";

const REFERENCE_DATE = new Date("2026-07-30T00:00:00Z");

function validInput(overrides: Partial<Step1Input> = {}): Step1Input {
  return {
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@example.com",
    phone: "604-555-0123",
    dateOfBirth: "1990-01-01",
    ...overrides,
  };
}

test("MIN_AGE_YEARS is 16 per BC general minimum working age assumption", () => {
  assert.equal(MIN_AGE_YEARS, 16);
});

test("validateStep1: happy path returns no errors", () => {
  const errors = validateStep1(validInput(), REFERENCE_DATE);
  assert.deepEqual(errors, []);
});

test("isStep1Valid: true for happy path", () => {
  assert.equal(isStep1Valid(validInput(), REFERENCE_DATE), true);
});

test("validateStep1: empty firstName produces a firstName error", () => {
  const errors = validateStep1(validInput({ firstName: "  " }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "firstName");
});

test("validateStep1: empty lastName produces a lastName error", () => {
  const errors = validateStep1(validInput({ lastName: "" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "lastName");
});

test("validateStep1: name too short produces an error", () => {
  const errors = validateStep1(validInput({ firstName: "A" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "firstName");
});

test("validateStep1: name too long produces an error", () => {
  const errors = validateStep1(
    validInput({ firstName: "A".repeat(101) }),
    REFERENCE_DATE
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "firstName");
});

test("validateStep1: malformed email produces an email error", () => {
  const errors = validateStep1(validInput({ email: "not-an-email" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "email");
});

test("validateStep1: empty email produces an email error", () => {
  const errors = validateStep1(validInput({ email: "" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "email");
});

test("validateStep1: phone with letters produces a phone error", () => {
  const errors = validateStep1(validInput({ phone: "604-CALL-NOW" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "phone");
});

test("validateStep1: phone with too few digits produces a phone error", () => {
  const errors = validateStep1(validInput({ phone: "604-555-012" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "phone");
});

test("validateStep1: phone accepts +1 prefix and separators", () => {
  const errors = validateStep1(validInput({ phone: "+1 (604) 555-0123" }), REFERENCE_DATE);
  assert.deepEqual(errors, []);
});

test("validateStep1: phone accepts bare 10 digits with no separators", () => {
  const errors = validateStep1(validInput({ phone: "6045550123" }), REFERENCE_DATE);
  assert.deepEqual(errors, []);
});

test("validateStep1: invalid calendar date (Feb 30) produces a dateOfBirth error", () => {
  const errors = validateStep1(validInput({ dateOfBirth: "1990-02-30" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "dateOfBirth");
});

test("validateStep1: candidate younger than MIN_AGE_YEARS produces a dateOfBirth error", () => {
  // Reference date 2026-07-30; born 2011-08-01 -> turns 15 on 2026-08-01,
  // so on the reference date they are still 14 (under MIN_AGE_YEARS=16).
  const errors = validateStep1(
    validInput({ dateOfBirth: "2011-08-01" }),
    REFERENCE_DATE
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "dateOfBirth");
  assert.match(errors[0].message, /at least 16 years old/);
});

test("boundary: candidate turning exactly MIN_AGE_YEARS on referenceDate is VALID", () => {
  // Decision: turning MIN_AGE_YEARS old ON referenceDate counts as meeting
  // the minimum age (age is calculated by full elapsed birthdays; someone
  // born 2010-07-30 has, as of 2026-07-30, already had their 16th
  // birthday "today" and is treated as 16, not 15).
  const errors = validateStep1(
    validInput({ dateOfBirth: "2010-07-30" }),
    REFERENCE_DATE
  );
  assert.deepEqual(errors, []);
});

test("boundary: candidate turning MIN_AGE_YEARS one day AFTER referenceDate is INVALID", () => {
  const errors = validateStep1(
    validInput({ dateOfBirth: "2010-07-31" }),
    REFERENCE_DATE
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "dateOfBirth");
});

test("boundary: candidate who turned MIN_AGE_YEARS one day BEFORE referenceDate is VALID", () => {
  const errors = validateStep1(
    validInput({ dateOfBirth: "2010-07-29" }),
    REFERENCE_DATE
  );
  assert.deepEqual(errors, []);
});

test("validateStep1: missing dateOfBirth produces a dateOfBirth error", () => {
  const errors = validateStep1(validInput({ dateOfBirth: "" }), REFERENCE_DATE);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "dateOfBirth");
});

test("validateStep1: accumulates ALL errors at once, not just the first", () => {
  const errors = validateStep1(
    {
      firstName: "",
      lastName: "",
      email: "bad-email",
      phone: "abc",
      dateOfBirth: "2020-01-01", // way under MIN_AGE_YEARS
    },
    REFERENCE_DATE
  );

  const fields = errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["dateOfBirth", "email", "firstName", "lastName", "phone"]);
});

test("isStep1Valid: false when there are validation errors", () => {
  assert.equal(isStep1Valid(validInput({ email: "bad" }), REFERENCE_DATE), false);
});

test("validateStep1: defaults referenceDate to now when not provided (smoke test)", () => {
  // Just verifies it doesn't throw and returns an array when referenceDate
  // is omitted; determinism for age logic itself is covered by the tests
  // above using an explicit referenceDate.
  const errors = validateStep1(validInput({ dateOfBirth: "1990-01-01" }));
  assert.ok(Array.isArray(errors));
});

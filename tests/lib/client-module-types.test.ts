import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidCanadianPhone,
  isValidBcPostalCode,
} from "../../src/lib/client-module/types";

// ---------------------------------------------------------------------------
// isValidEmail
// ---------------------------------------------------------------------------

test("isValidEmail: accepts a plausible email", () => {
  assert.equal(isValidEmail("jane.doe@example.com"), true);
});

test("isValidEmail: rejects empty string", () => {
  assert.equal(isValidEmail(""), false);
});

test("isValidEmail: rejects whitespace-only string", () => {
  assert.equal(isValidEmail("   "), false);
});

test("isValidEmail: rejects missing @", () => {
  assert.equal(isValidEmail("jane.doe.example.com"), false);
});

test("isValidEmail: rejects missing domain dot", () => {
  assert.equal(isValidEmail("jane@example"), false);
});

test("isValidEmail: rejects spaces inside address", () => {
  assert.equal(isValidEmail("jane doe@example.com"), false);
});

// ---------------------------------------------------------------------------
// isValidCanadianPhone
// ---------------------------------------------------------------------------

test("isValidCanadianPhone: accepts plain 10 digits", () => {
  assert.equal(isValidCanadianPhone("6045550123"), true);
});

test("isValidCanadianPhone: accepts dashed format", () => {
  assert.equal(isValidCanadianPhone("604-555-0123"), true);
});

test("isValidCanadianPhone: accepts +1 prefix with spaces", () => {
  assert.equal(isValidCanadianPhone("+1 604 555 0123"), true);
});

test("isValidCanadianPhone: accepts parenthesized area code", () => {
  assert.equal(isValidCanadianPhone("(604) 555-0123"), true);
});

test("isValidCanadianPhone: accepts leading 1 with no separators", () => {
  assert.equal(isValidCanadianPhone("16045550123"), true);
});

test("isValidCanadianPhone: rejects too few digits", () => {
  assert.equal(isValidCanadianPhone("604555012"), false);
});

test("isValidCanadianPhone: rejects too many digits", () => {
  assert.equal(isValidCanadianPhone("160455501234"), false);
});

test("isValidCanadianPhone: rejects empty string", () => {
  assert.equal(isValidCanadianPhone(""), false);
});

test("isValidCanadianPhone: rejects letters", () => {
  assert.equal(isValidCanadianPhone("604-555-ABCD"), false);
});

// ---------------------------------------------------------------------------
// isValidBcPostalCode
// ---------------------------------------------------------------------------

test("isValidBcPostalCode: accepts format with space (typical BC prefix V)", () => {
  assert.equal(isValidBcPostalCode("V8W 1A1"), true);
});

test("isValidBcPostalCode: accepts format without space", () => {
  assert.equal(isValidBcPostalCode("V8W1A1"), true);
});

test("isValidBcPostalCode: accepts lowercase input", () => {
  assert.equal(isValidBcPostalCode("v8w 1a1"), true);
});

test("isValidBcPostalCode: accepts a non-BC-prefixed but well-formed Canadian postal code (format-only validation, documented)", () => {
  assert.equal(isValidBcPostalCode("M5V 2T6"), true);
});

test("isValidBcPostalCode: rejects US zip code format", () => {
  assert.equal(isValidBcPostalCode("90210"), false);
});

test("isValidBcPostalCode: rejects empty string", () => {
  assert.equal(isValidBcPostalCode(""), false);
});

test("isValidBcPostalCode: rejects wrong pattern (two letters together)", () => {
  assert.equal(isValidBcPostalCode("VV8 1A1"), false);
});

test("isValidBcPostalCode: rejects reserved letter D in the pattern", () => {
  assert.equal(isValidBcPostalCode("D8W 1A1"), false);
});

test("isValidBcPostalCode: rejects reserved letter F, I, O, Q, U anywhere a letter is expected", () => {
  assert.equal(isValidBcPostalCode("V8I 1A1"), false);
  assert.equal(isValidBcPostalCode("V8W 1O1"), false);
});

test("isValidBcPostalCode: rejects W or Z as the first letter", () => {
  assert.equal(isValidBcPostalCode("W8V 1A1"), false);
  assert.equal(isValidBcPostalCode("Z8V 1A1"), false);
});

test("isValidBcPostalCode: rejects extra characters", () => {
  assert.equal(isValidBcPostalCode("V8W 1A1X"), false);
});

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getVancouverOffset,
  parseVancouverDateTime,
  getVancouverTodayString,
} from "../../src/lib/date-utils";

describe("date-utils", () => {
  describe("getVancouverOffset", () => {
    it("returns -07:00 for a summer date (PDT)", () => {
      assert.strictEqual(getVancouverOffset("2026-07-15"), "-07:00");
    });

    it("returns -08:00 for a winter date (PST)", () => {
      assert.strictEqual(getVancouverOffset("2026-01-15"), "-08:00");
    });
  });

  describe("parseVancouverDateTime", () => {
    it("parses summer datetime to UTC correctly", () => {
      const dt = parseVancouverDateTime("2026-07-15", "10:00");
      // 10:00 PDT = 17:00 UTC
      assert.strictEqual(dt.toISOString(), "2026-07-15T17:00:00.000Z");
    });

    it("parses winter datetime to UTC correctly", () => {
      const dt = parseVancouverDateTime("2026-01-15", "10:00");
      // 10:00 PST = 18:00 UTC
      assert.strictEqual(dt.toISOString(), "2026-01-15T18:00:00.000Z");
    });
  });

  describe("getVancouverTodayString", () => {
    it("returns a YYYY-MM-DD string", () => {
      const today = getVancouverTodayString();
      assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

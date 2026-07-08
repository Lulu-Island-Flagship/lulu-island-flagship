import { describe, it } from "node:test";
import assert from "node:assert";
import { lookupBcAssessment } from "@/lib/bc-assessment";

describe("lookupBcAssessment", () => {
  it("returns unavailable when provider is not configured", async () => {
    delete process.env.BC_ASSESSMENT_API_URL;
    const result = await lookupBcAssessment("123 Main St, Richmond, BC");
    assert.strictEqual(result.confidence, "unavailable");
    assert.strictEqual(result.source, "none");
    assert.ok(result.message?.includes("not configured"));
  });

  it("returns unavailable when provider returns invalid JSON", async () => {
    process.env.BC_ASSESSMENT_API_URL = "https://example.com/bc-assessment";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ error: "not found" }),
      } as Response);

    const result = await lookupBcAssessment("123 Main St, Richmond, BC");
    assert.strictEqual(result.confidence, "unavailable");
    assert.ok(result.message?.includes("did not return a usable living area"));

    global.fetch = originalFetch;
  });

  it("returns suggestion when provider returns squareFeet", async () => {
    process.env.BC_ASSESSMENT_API_URL = "https://example.com/bc-assessment";
    const originalFetch = global.fetch;
    global.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ squareFeet: 1250, confidence: "medium" }),
      } as Response);

    const result = await lookupBcAssessment("123 Main St, Richmond, BC");
    assert.strictEqual(result.confidence, "medium");
    assert.strictEqual(result.squareFeet, 1250);
    assert.strictEqual(result.source, "https://example.com/bc-assessment");

    global.fetch = originalFetch;
  });

  it("returns unavailable when fetch throws", async () => {
    process.env.BC_ASSESSMENT_API_URL = "https://example.com/bc-assessment";
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error("Network failure");
    };

    const result = await lookupBcAssessment("123 Main St, Richmond, BC");
    assert.strictEqual(result.confidence, "unavailable");
    assert.ok(result.message?.includes("Provider lookup failed"));

    global.fetch = originalFetch;
  });
});

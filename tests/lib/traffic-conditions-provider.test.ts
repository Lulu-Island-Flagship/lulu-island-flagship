import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getMorningConditions,
  shouldNotifyClientOfDelay,
  DELAY_SMS_THRESHOLD_MINUTES,
} from "../../src/lib/traffic-conditions-provider";

describe("getMorningConditions", () => {
  it("devuelve not_configured de forma determinista (sin proveedor real)", async () => {
    const result = await getMorningConditions({ zone: "Richmond", date: "2026-07-14" });
    assert.equal(result.status, "not_configured");
    assert.equal(result.estimatedDelayMinutes, null);
    assert.equal(result.roadClosureReported, null);
  });
});

describe("shouldNotifyClientOfDelay", () => {
  it("no notifica si no hay dato (null)", () => {
    assert.equal(shouldNotifyClientOfDelay(null), false);
  });

  it("no notifica exactamente en el umbral (15 min)", () => {
    assert.equal(shouldNotifyClientOfDelay(DELAY_SMS_THRESHOLD_MINUTES), false);
  });

  it("notifica por encima del umbral", () => {
    assert.equal(shouldNotifyClientOfDelay(16), true);
  });

  it("no notifica por debajo del umbral", () => {
    assert.equal(shouldNotifyClientOfDelay(5), false);
  });
});

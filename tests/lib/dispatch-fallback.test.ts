import { describe, it } from "node:test";
import assert from "node:assert";
import {
  evaluateDispatchDiscrepancyFallback,
  DISPATCH_DISCREPANCY_FALLBACK_MINUTES,
} from "../../src/lib/dispatch-fallback";

describe("evaluateDispatchDiscrepancyFallback", () => {
  it("no vence antes de los 10 minutos", () => {
    const result = evaluateDispatchDiscrepancyFallback(
      "2026-07-10T16:30:00Z",
      "2026-07-10T16:38:00Z",
      null
    );
    assert.equal(result.expired, false);
    assert.ok(result.minutesElapsed < 10);
  });

  it("vence exactamente a los 10 minutos", () => {
    const result = evaluateDispatchDiscrepancyFallback(
      "2026-07-10T16:30:00Z",
      "2026-07-10T16:40:00Z",
      null
    );
    assert.equal(result.expired, true);
  });

  it("vence después de los 10 minutos", () => {
    const result = evaluateDispatchDiscrepancyFallback(
      "2026-07-10T16:30:00Z",
      "2026-07-10T17:00:00Z",
      null
    );
    assert.equal(result.expired, true);
    assert.equal(result.minutesElapsed, 30);
  });

  it("nunca vence si el admin ya respondió", () => {
    const result = evaluateDispatchDiscrepancyFallback(
      "2026-07-10T16:30:00Z",
      "2026-07-10T17:30:00Z",
      "2026-07-10T16:35:00Z"
    );
    assert.equal(result.expired, false);
    assert.equal(result.minutesElapsed, 0);
  });

  it("la decisión pre-aprobada siempre es escalar a la bandeja unificada, nunca auto-asignar (B.2.13)", () => {
    const result = evaluateDispatchDiscrepancyFallback(
      "2026-07-10T16:30:00Z",
      "2026-07-10T16:45:00Z",
      null
    );
    assert.equal(result.decision, "escalate_to_unified_inbox");
  });

  it("respeta un timerMinutes custom", () => {
    assert.equal(
      evaluateDispatchDiscrepancyFallback(
        "2026-07-10T16:30:00Z",
        "2026-07-10T16:34:00Z",
        null,
        5
      ).expired,
      false
    );
    assert.equal(
      evaluateDispatchDiscrepancyFallback(
        "2026-07-10T16:30:00Z",
        "2026-07-10T16:35:00Z",
        null,
        5
      ).expired,
      true
    );
  });

  it("DISPATCH_DISCREPANCY_FALLBACK_MINUTES es 10 (invariante B.2.12)", () => {
    assert.equal(DISPATCH_DISCREPANCY_FALLBACK_MINUTES, 10);
  });
});

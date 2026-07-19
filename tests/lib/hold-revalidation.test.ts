import { describe, it } from "node:test";
import assert from "node:assert";
import { decideHoldRevalidationAction } from "../../src/lib/hold-revalidation";

describe("decideHoldRevalidationAction", () => {
  it("hold sigue vigente (requires_capture) -> hold_valid", () => {
    const decision = decideHoldRevalidationAction({
      holdStatus: "requires_capture",
      reauthAttempts: 0,
    });
    assert.equal(decision.action, "hold_valid");
  });

  it("hold inválido con intentos disponibles -> needs_reauth", () => {
    const decision = decideHoldRevalidationAction({
      holdStatus: "canceled",
      reauthAttempts: 0,
    });
    assert.equal(decision.action, "needs_reauth");
  });

  it("hold inválido y ya se agotaron los intentos -> give_up_notify_ops", () => {
    const decision = decideHoldRevalidationAction({
      holdStatus: "requires_payment_method",
      reauthAttempts: 3,
      maxReauthAttempts: 3,
    });
    assert.equal(decision.action, "give_up_notify_ops");
    if (decision.action === "give_up_notify_ops") {
      assert.match(decision.reason, /requires_payment_method/);
    }
  });

  it("retrieve falló (status null) se trata igual que un hold inválido", () => {
    const decision = decideHoldRevalidationAction({
      holdStatus: null,
      reauthAttempts: 1,
    });
    assert.equal(decision.action, "needs_reauth");
  });

  it("respeta maxReauthAttempts por defecto (3)", () => {
    const decision = decideHoldRevalidationAction({
      holdStatus: "canceled",
      reauthAttempts: 2,
    });
    assert.equal(decision.action, "needs_reauth");

    const decisionAtLimit = decideHoldRevalidationAction({
      holdStatus: "canceled",
      reauthAttempts: 3,
    });
    assert.equal(decisionAtLimit.action, "give_up_notify_ops");
  });
});

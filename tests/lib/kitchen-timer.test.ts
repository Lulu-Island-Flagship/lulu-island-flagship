import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isKitchenTimerExpired,
  isHotSurfaceItemUnlocked,
  minutesRemaining,
  KITCHEN_HOT_SURFACE_WAIT_MINUTES,
} from "../../src/lib/kitchen-timer";

describe("isKitchenTimerExpired", () => {
  it("no vence si el temporizador nunca se inició (startedAtIso null)", () => {
    assert.equal(isKitchenTimerExpired(null, "2026-07-10T10:00:00Z"), false);
  });

  it("no vence antes de los 10 minutos", () => {
    assert.equal(
      isKitchenTimerExpired("2026-07-10T10:00:00Z", "2026-07-10T10:09:59Z"),
      false
    );
  });

  it("vence exactamente a los 10 minutos", () => {
    assert.equal(
      isKitchenTimerExpired("2026-07-10T10:00:00Z", "2026-07-10T10:10:00Z"),
      true
    );
  });

  it("vence después de los 10 minutos", () => {
    assert.equal(
      isKitchenTimerExpired("2026-07-10T10:00:00Z", "2026-07-10T10:25:00Z"),
      true
    );
  });

  it("respeta un waitMinutes custom", () => {
    assert.equal(
      isKitchenTimerExpired("2026-07-10T10:00:00Z", "2026-07-10T10:04:00Z", 5),
      false
    );
    assert.equal(
      isKitchenTimerExpired("2026-07-10T10:00:00Z", "2026-07-10T10:05:00Z", 5),
      true
    );
  });

  it("KITCHEN_HOT_SURFACE_WAIT_MINUTES es 10 (regla exacta del plan D.7)", () => {
    assert.equal(KITCHEN_HOT_SURFACE_WAIT_MINUTES, 10);
  });
});

describe("isHotSurfaceItemUnlocked", () => {
  it("es un alias directo de isKitchenTimerExpired", () => {
    assert.equal(
      isHotSurfaceItemUnlocked("2026-07-10T10:00:00Z", "2026-07-10T10:05:00Z"),
      false
    );
    assert.equal(
      isHotSurfaceItemUnlocked("2026-07-10T10:00:00Z", "2026-07-10T10:10:00Z"),
      true
    );
  });

  it("un ítem sin timer iniciado permanece bloqueado", () => {
    assert.equal(isHotSurfaceItemUnlocked(null, "2026-07-10T10:10:00Z"), false);
  });
});

describe("minutesRemaining", () => {
  it("devuelve el total si el timer no ha iniciado", () => {
    assert.equal(minutesRemaining(null, "2026-07-10T10:00:00Z"), 10);
  });

  it("cuenta regresivamente mientras corre el timer", () => {
    assert.equal(
      minutesRemaining("2026-07-10T10:00:00Z", "2026-07-10T10:03:00Z"),
      7
    );
  });

  it("nunca es negativo una vez vencido", () => {
    assert.equal(
      minutesRemaining("2026-07-10T10:00:00Z", "2026-07-10T10:30:00Z"),
      0
    );
  });
});

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { logEvent, captureError } from "../../src/lib/observability";

describe("logEvent", () => {
  it("no lanza y no requiere configuración", () => {
    assert.doesNotThrow(() => logEvent("test_event", { foo: "bar" }));
  });
});

describe("captureError", () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it("devuelve not_configured cuando no hay SENTRY_DSN", () => {
    delete process.env.SENTRY_DSN;
    const result = captureError(new Error("boom"));
    assert.equal(result.status, "not_configured");
    assert.ok(result.loggedAt);
  });

  it("devuelve logged_locally cuando SENTRY_DSN está presente (SDK aún no instalado)", () => {
    process.env.SENTRY_DSN = "https://fake@example.ingest.sentry.io/1";
    const result = captureError(new Error("boom"));
    assert.equal(result.status, "logged_locally");
  });

  it("acepta errores que no son instancias de Error sin lanzar", () => {
    delete process.env.SENTRY_DSN;
    assert.doesNotThrow(() => captureError("string error", { route: "test" }));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  resolveOperatingMode,
  describeOperatingMode,
  AUTOPILOT_MODE_FLAG_NAME,
} from "../../src/lib/autopilot-mode";

describe("resolveOperatingMode", () => {
  it("activo=true -> autopilot", () => {
    assert.equal(resolveOperatingMode(true), "autopilot");
  });

  it("activo=false -> manual", () => {
    assert.equal(resolveOperatingMode(false), "manual");
  });
});

describe("describeOperatingMode", () => {
  it("autopilot no menciona revisión pendiente", () => {
    const d = describeOperatingMode(true);
    assert.equal(d.mode, "autopilot");
    assert.equal(d.label, "Autopilot");
    assert.ok(!d.explanation.toLowerCase().includes("pendiente de revisión"));
  });

  it("manual menciona que sigue auto-decidiendo a los 10 min", () => {
    const d = describeOperatingMode(false);
    assert.equal(d.mode, "manual");
    assert.ok(d.explanation.includes("10 min"));
  });

  it("el nombre del flag es estable", () => {
    assert.equal(AUTOPILOT_MODE_FLAG_NAME, "e0_autopilot_mode");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import { isValidAcquisitionChannel, ACQUISITION_CHANNELS } from "../../src/lib/acquisition-channel";

describe("isValidAcquisitionChannel", () => {
  it("acepta cada canal declarado", () => {
    for (const c of ACQUISITION_CHANNELS) {
      assert.equal(isValidAcquisitionChannel(c), true);
    }
  });

  it("rechaza valores inválidos", () => {
    assert.equal(isValidAcquisitionChannel("tv_ad"), false);
    assert.equal(isValidAcquisitionChannel(""), false);
    assert.equal(isValidAcquisitionChannel(null), false);
    assert.equal(isValidAcquisitionChannel(undefined), false);
  });
});

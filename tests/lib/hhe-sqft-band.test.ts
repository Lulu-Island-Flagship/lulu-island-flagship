import { describe, it } from "node:test";
import assert from "node:assert";
import { sqftToRangeIndex, HHE_RANGE_LABELS } from "../../src/lib/hhe-sqft-band";

describe("sqftToRangeIndex", () => {
  it("clasifica los límites y el interior de cada banda", () => {
    assert.equal(sqftToRangeIndex(1), 0);
    assert.equal(sqftToRangeIndex(700), 0);
    assert.equal(sqftToRangeIndex(701), 1);
    assert.equal(sqftToRangeIndex(1500), 1);
    assert.equal(sqftToRangeIndex(1501), 2);
    assert.equal(sqftToRangeIndex(2500), 2);
    assert.equal(sqftToRangeIndex(2501), 3);
    assert.equal(sqftToRangeIndex(3500), 3);
    assert.equal(sqftToRangeIndex(3501), 4);
    assert.equal(sqftToRangeIndex(10000), 4);
  });

  it("tiene exactamente 5 etiquetas, una por banda", () => {
    assert.equal(HHE_RANGE_LABELS.length, 5);
  });
});

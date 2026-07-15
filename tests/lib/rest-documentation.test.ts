import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideRestDocumentation,
  computeContinuousMinutesAfterTransit,
} from "../../src/lib/rest-documentation";

test("driver: transit never satisfies the ESA break, no matter how long", () => {
  const result = decideRestDocumentation({
    transitMinutes: 45,
    cumulativeContinuousMinutesBefore: 400,
    role: "driver",
  });
  assert.equal(result.satisfiesEsaBreak, false);
  assert.equal(result.reason, "driving_is_work_not_a_break");
});

test("passenger: satisfies break when >=30min AND >=5h continuous work before", () => {
  const result = decideRestDocumentation({
    transitMinutes: 30,
    cumulativeContinuousMinutesBefore: 300,
    role: "passenger",
  });
  assert.equal(result.satisfiesEsaBreak, true);
});

test("passenger: does not satisfy if under 5h continuous work yet", () => {
  const result = decideRestDocumentation({
    transitMinutes: 40,
    cumulativeContinuousMinutesBefore: 200,
    role: "passenger",
  });
  assert.equal(result.satisfiesEsaBreak, false);
  assert.equal(result.reason, "break_not_yet_due_under_5h_continuous_threshold");
});

test("passenger: does not satisfy if transit shorter than 30 min, even after 5h", () => {
  const result = decideRestDocumentation({
    transitMinutes: 15,
    cumulativeContinuousMinutesBefore: 320,
    role: "passenger",
  });
  assert.equal(result.satisfiesEsaBreak, false);
  assert.match(result.reason, /transit_shorter_than_required/);
});

test("solo_no_vehicle: same rules as passenger (not driving)", () => {
  const result = decideRestDocumentation({
    transitMinutes: 30,
    cumulativeContinuousMinutesBefore: 305,
    role: "solo_no_vehicle",
  });
  assert.equal(result.satisfiesEsaBreak, true);
});

test("computeContinuousMinutesAfterTransit: resets to 0 when break satisfied", () => {
  const decision = { satisfiesEsaBreak: true, reason: "x" };
  assert.equal(computeContinuousMinutesAfterTransit(320, 30, decision, "passenger"), 0);
});

test("computeContinuousMinutesAfterTransit: driver keeps accumulating (still working)", () => {
  const decision = { satisfiesEsaBreak: false, reason: "driving_is_work_not_a_break" };
  assert.equal(computeContinuousMinutesAfterTransit(200, 20, decision, "driver"), 220);
});

test("computeContinuousMinutesAfterTransit: passenger whose break didn't qualify keeps prior count unchanged", () => {
  const decision = { satisfiesEsaBreak: false, reason: "transit_shorter_than_required_30_minutes" };
  assert.equal(computeContinuousMinutesAfterTransit(200, 10, decision, "passenger"), 200);
});

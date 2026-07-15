import { describe, it } from "node:test";
import assert from "node:assert";
import {
  computeClientSegment,
  mapSegmentToChurnPattern,
  VIP_MONTHLY_SPEND_THRESHOLD_CENTS,
  REGULAR_MIN_MONTHLY_SPEND_CENTS,
  NEW_CLIENT_MAX_SERVICES,
  AT_RISK_DAYS_SINCE_LAST_SERVICE,
} from "../../src/lib/client-segmentation";

describe("computeClientSegment", () => {
  it("nuevo si tiene 1-2 servicios, sin importar el gasto", () => {
    assert.equal(
      computeClientSegment({ monthlySpendCents: 100000, totalServicesCount: 1, daysSinceLastService: 0 }),
      "new"
    );
    assert.equal(
      computeClientSegment({ monthlySpendCents: 0, totalServicesCount: NEW_CLIENT_MAX_SERVICES, daysSinceLastService: 0 }),
      "new"
    );
  });

  it("en riesgo si 60+ días sin servicio y ya no es nuevo", () => {
    const segment = computeClientSegment({
      monthlySpendCents: 100000,
      totalServicesCount: 5,
      daysSinceLastService: AT_RISK_DAYS_SINCE_LAST_SERVICE,
    });
    assert.equal(segment, "at_risk");
  });

  it("un cliente nuevo con 60+ días sin servicio sigue siendo 'new', no 'at_risk'", () => {
    const segment = computeClientSegment({
      monthlySpendCents: 0,
      totalServicesCount: 1,
      daysSinceLastService: 200,
    });
    assert.equal(segment, "new");
  });

  it("VIP por gasto mensual > $500", () => {
    const segment = computeClientSegment({
      monthlySpendCents: VIP_MONTHLY_SPEND_THRESHOLD_CENTS + 1,
      totalServicesCount: 5,
      daysSinceLastService: 10,
    });
    assert.equal(segment, "vip");
  });

  it("VIP por más de 10 servicios históricos, aunque el gasto mensual sea bajo", () => {
    const segment = computeClientSegment({
      monthlySpendCents: 5000,
      totalServicesCount: 11,
      daysSinceLastService: 10,
    });
    assert.equal(segment, "vip");
  });

  it("regular entre $200 y $500 de gasto mensual", () => {
    const segment = computeClientSegment({
      monthlySpendCents: REGULAR_MIN_MONTHLY_SPEND_CENTS,
      totalServicesCount: 5,
      daysSinceLastService: 10,
    });
    assert.equal(segment, "regular");
  });

  it("esporádico por debajo de $200 de gasto mensual", () => {
    const segment = computeClientSegment({
      monthlySpendCents: REGULAR_MIN_MONTHLY_SPEND_CENTS - 1,
      totalServicesCount: 5,
      daysSinceLastService: 10,
    });
    assert.equal(segment, "sporadic");
  });
});

describe("mapSegmentToChurnPattern", () => {
  it("VIP y Regular mapean a 'recurring'", () => {
    assert.equal(mapSegmentToChurnPattern("vip"), "recurring");
    assert.equal(mapSegmentToChurnPattern("regular"), "recurring");
  });
  it("esporádico mapea a 'sporadic'", () => {
    assert.equal(mapSegmentToChurnPattern("sporadic"), "sporadic");
  });
  it("nuevo y en riesgo no mapean (null)", () => {
    assert.equal(mapSegmentToChurnPattern("new"), null);
    assert.equal(mapSegmentToChurnPattern("at_risk"), null);
  });
});

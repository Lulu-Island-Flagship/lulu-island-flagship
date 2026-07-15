import { describe, it } from "node:test";
import assert from "node:assert";
import { computeClosingEarnings, DEFAULT_UPSELL_COMMISSION_RATE } from "../../src/lib/shift-ritual";

describe("computeClosingEarnings", () => {
  it("solo Day Rate cuando no hay upsells", () => {
    const r = computeClosingEarnings({ dayRateDollars: 90, approvedUpsellAmountsDollars: [] });
    assert.equal(r.commissionDollars, 0);
    assert.equal(r.totalDollars, 90);
    assert.equal(r.summaryText, "Day Rate $90 + comisiones $0.00 = $90.00");
  });

  it("reproduce el ejemplo exacto del plan (Day Rate $90 + comisiones $12.50 = $102.50)", () => {
    // comisión 15% de upsells que sumen $83.33... probamos con montos que den $12.50 exacto
    const r = computeClosingEarnings({ dayRateDollars: 90, approvedUpsellAmountsDollars: [83.33], commissionRate: 0.15 });
    assert.equal(r.dayRateDollars, 90);
    assert.ok(Math.abs(r.commissionDollars - 12.5) < 0.01);
  });

  it("usa la tasa por defecto de 15% si no se especifica", () => {
    const r = computeClosingEarnings({ dayRateDollars: 100, approvedUpsellAmountsDollars: [100] });
    assert.equal(r.commissionDollars, 15);
    assert.equal(DEFAULT_UPSELL_COMMISSION_RATE, 0.15);
  });

  it("suma múltiples upsells antes de aplicar la comisión", () => {
    const r = computeClosingEarnings({ dayRateDollars: 100, approvedUpsellAmountsDollars: [45, 35, 55] });
    // (45+35+55) * 0.15 = 20.25
    assert.equal(r.commissionDollars, 20.25);
    assert.equal(r.totalDollars, 120.25);
  });

  it("respeta una tasa de comisión personalizada", () => {
    const r = computeClosingEarnings({ dayRateDollars: 100, approvedUpsellAmountsDollars: [100], commissionRate: 0.2 });
    assert.equal(r.commissionDollars, 20);
  });
});

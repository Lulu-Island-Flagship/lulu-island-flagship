import { describe, it } from "node:test";
import assert from "node:assert";
import {
  calculateReserveSplit,
  evaluateDailyCashExposure,
  TAX_RESERVE_RATE,
} from "../../src/lib/cash-reserve";

describe("calculateReserveSplit", () => {
  it("reserva exactamente el 12% de un cobro sin propina ni no-gravable", () => {
    const r = calculateReserveSplit({ grossAmountCents: 10000 }); // $100.00
    assert.equal(r.taxableBaseCents, 10000);
    assert.equal(r.taxReserveCents, 1200); // 12%
    assert.equal(r.operationalAmountCents, 8800);
    assert.equal(r.reserveRate, TAX_RESERVE_RATE);
  });

  it("excluye propina de la base gravable antes de reservar", () => {
    const r = calculateReserveSplit({ grossAmountCents: 11000, tipAmountCents: 1000 }); // $110 con $10 propina
    assert.equal(r.taxableBaseCents, 10000);
    assert.equal(r.taxReserveCents, 1200);
    // operativo = bruto - reserva (la propina queda en operativo, no se reserva)
    assert.equal(r.operationalAmountCents, 9800);
  });

  it("excluye partidas no gravables ademas de la propina", () => {
    const r = calculateReserveSplit({
      grossAmountCents: 12000,
      tipAmountCents: 1000,
      nonTaxableAmountCents: 1000,
    });
    assert.equal(r.taxableBaseCents, 10000);
    assert.equal(r.taxReserveCents, 1200);
  });

  it("nunca excede el bruto aunque propina+no-gravable superen el total (guard defensivo)", () => {
    const r = calculateReserveSplit({
      grossAmountCents: 500,
      tipAmountCents: 1000,
      nonTaxableAmountCents: 1000,
    });
    assert.equal(r.taxableBaseCents, 0);
    assert.equal(r.taxReserveCents, 0);
    assert.equal(r.operationalAmountCents, 500);
  });

  it("redondea al centavo", () => {
    const r = calculateReserveSplit({ grossAmountCents: 9999 });
    assert.equal(r.taxReserveCents, Math.round(9999 * 0.12));
  });
});

describe("evaluateDailyCashExposure", () => {
  it("bajo el tope, overCap=false", () => {
    const r = evaluateDailyCashExposure({ pendingExposureCents: 500000, dailyCapCents: 2000000 });
    assert.equal(r.overCap, false);
    assert.ok(Math.abs(r.exposureRatio - 0.25) < 0.0001);
  });

  it("sobre el tope, overCap=true", () => {
    const r = evaluateDailyCashExposure({ pendingExposureCents: 2500000, dailyCapCents: 2000000 });
    assert.equal(r.overCap, true);
    assert.ok(r.exposureRatio > 1);
  });

  it("exactamente en el tope no dispara alerta (estrictamente mayor)", () => {
    const r = evaluateDailyCashExposure({ pendingExposureCents: 2000000, dailyCapCents: 2000000 });
    assert.equal(r.overCap, false);
  });
});

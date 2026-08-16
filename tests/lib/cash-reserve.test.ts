import { describe, it } from "node:test";
import assert from "node:assert";
import {
  calculateReserveSplit,
  evaluateDailyCashExposure,
  TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL,
} from "../../src/lib/cash-reserve";

// B-P1-3 fix (auditoría 2026-07-21): grossAmountCents es un total que YA
// incluye el 12% de impuesto (quotes.total = subtotal + gst + pst), así
// que el impuesto real dentro de un total T es T × (0.12/1.12) ≈
// 10.714%, no 12% de T (eso sobre-reservaría). Estos tests reflejan la
// extracción "tax-inclusive" correcta en vez de la tasa aditiva anterior.
describe("calculateReserveSplit", () => {
  it("reserva ~10.714% (12% tax-inclusive) de un cobro sin propina ni no-gravable", () => {
    const r = calculateReserveSplit({ grossAmountCents: 10000 }); // $100.00
    assert.equal(r.taxableBaseCents, 10000);
    assert.equal(r.taxReserveCents, 1071); // exacto: 10000 × 3/28 → 1071.43 → 1071
    assert.equal(r.operationalAmountCents, 10000 - r.taxReserveCents);
    assert.equal(r.reserveRate, TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL);
  });

  it("excluye propina de la base gravable antes de reservar", () => {
    const r = calculateReserveSplit({ grossAmountCents: 11000, tipAmountCents: 1000 }); // $110 con $10 propina
    assert.equal(r.taxableBaseCents, 10000);
    assert.equal(r.taxReserveCents, 1071);
    // operativo = bruto - reserva (la propina queda en operativo, no se reserva)
    assert.equal(r.operationalAmountCents, 11000 - r.taxReserveCents);
  });

  it("excluye partidas no gravables ademas de la propina", () => {
    const r = calculateReserveSplit({
      grossAmountCents: 12000,
      tipAmountCents: 1000,
      nonTaxableAmountCents: 1000,
    });
    assert.equal(r.taxableBaseCents, 10000);
    assert.equal(r.taxReserveCents, 1071);
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
    assert.equal(r.taxReserveCents, 1071); // exacto: 9999 × 3/28 → 1071.32 → 1071
  });

  it("redondea medio-arriba en el límite .5 (exacto, sin float)", () => {
    // 14¢ × 3/28 = 1.5¢ → redondeo medio-arriba → 2¢ (el float 0.107142... daría 1¢)
    const r = calculateReserveSplit({ grossAmountCents: 14 });
    assert.equal(r.taxReserveCents, 2);
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

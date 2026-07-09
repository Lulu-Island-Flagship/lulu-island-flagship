import { describe, it } from "node:test";
import assert from "node:assert";
import { calculatePartnerCommission } from "../../src/lib/partner-commissions";

describe("calculatePartnerCommission", () => {
  it("agente inmobiliario: 10% SOLO en la primera reserva", () => {
    const r = calculatePartnerCommission({ partnerType: "real_estate_agent", orderValueCents: 20000, isFirstBooking: true });
    assert.equal(r.amountCents, 2000);
  });

  it("agente inmobiliario: reservas posteriores no generan comision", () => {
    const r = calculatePartnerCommission({ partnerType: "real_estate_agent", orderValueCents: 20000, isFirstBooking: false });
    assert.equal(r.amountCents, 0);
  });

  it("property manager: 5% (no depende de si es primera reserva)", () => {
    const r = calculatePartnerCommission({ partnerType: "property_manager", orderValueCents: 20000 });
    assert.equal(r.amountCents, 1000);
  });

  it("veterinario: $20 fijo sin importar el valor de la orden", () => {
    const r = calculatePartnerCommission({ partnerType: "veterinarian", orderValueCents: 99999 });
    assert.equal(r.amountCents, 2000);
  });

  it("constructor: 15%", () => {
    const r = calculatePartnerCommission({ partnerType: "builder", orderValueCents: 20000 });
    assert.equal(r.amountCents, 3000);
  });

  it("todos los tipos validos requieren T4A", () => {
    for (const t of ["real_estate_agent", "property_manager", "veterinarian", "builder"] as const) {
      const r = calculatePartnerCommission({ partnerType: t, orderValueCents: 10000, isFirstBooking: true });
      assert.equal(r.requiresT4A, true);
    }
  });
});

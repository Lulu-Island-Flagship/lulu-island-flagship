import { describe, it } from "node:test";
import assert from "node:assert";
import {
  calculateLtv,
  calculateCac,
  isCacHealthy,
  splitAttribution,
  calculateMarketingBudgetRange,
  allocateBudgetByChannel,
} from "../../src/lib/attribution";

describe("calculateLtv", () => {
  it("multiplica los 4 factores y SIEMPRE incluye la formula visible", () => {
    const r = calculateLtv({
      avgTicketCents: 10000,
      monthlyFrequency: 1.5,
      contributionMarginRatio: 0.4,
      observedRetentionMonths: 12,
    });
    assert.equal(r.valueCents, 72000);
    assert.match(r.formula, /ticket promedio/);
    assert.ok(r.inputs);
  });
});

describe("calculateCac", () => {
  it("divide gasto entre clientes nuevos", () => {
    assert.equal(calculateCac(100000, 10), 10000);
  });
  it("0 clientes nuevos no divide por cero", () => {
    assert.equal(calculateCac(100000, 0), 0);
  });
});

describe("isCacHealthy", () => {
  it("CAC < LTV/3 es saludable", () => {
    assert.equal(isCacHealthy(20000, 72000), true);
  });
  it("CAC >= LTV/3 no es saludable", () => {
    assert.equal(isCacHealthy(25000, 72000), false);
  });
});

describe("splitAttribution", () => {
  it("separa primer y ultimo toque por canal, sin fusionarlos", () => {
    const events = [
      { channel: "google", touch: "first" as const, occurredAt: "2026-01-01" },
      { channel: "google", touch: "last" as const, occurredAt: "2026-01-05" },
      { channel: "instagram", touch: "first" as const, occurredAt: "2026-01-02" },
    ];
    const r = splitAttribution(events);
    assert.equal(r.firstTouch.google, 1);
    assert.equal(r.lastTouch.google, 1);
    assert.equal(r.firstTouch.instagram, 1);
    assert.equal(r.lastTouch.instagram, undefined);
  });
});

describe("calculateMarketingBudgetRange", () => {
  it("calcula rango 8-10% del ingreso del mes anterior", () => {
    const r = calculateMarketingBudgetRange(10000000); // $100,000
    assert.equal(r.minCents, 800000);
    assert.equal(r.maxCents, 1000000);
  });
});

describe("allocateBudgetByChannel", () => {
  it("asigna proporcional a LTV/CAC de cada canal", () => {
    const alloc = allocateBudgetByChannel(100000, [
      { channel: "a", cacCents: 1000, ltvCents: 10000 }, // score 10
      { channel: "b", cacCents: 1000, ltvCents: 5000 }, // score 5
    ]);
    assert.ok(alloc.a > alloc.b);
    assert.equal(alloc.a + alloc.b, 100000);
  });

  it("canales sin datos (CAC=0) quedan fuera del reparto", () => {
    const alloc = allocateBudgetByChannel(100000, [
      { channel: "a", cacCents: 0, ltvCents: 0 },
    ]);
    assert.deepEqual(alloc, {});
  });
});

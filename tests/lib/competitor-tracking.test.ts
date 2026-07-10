import { describe, it } from "node:test";
import assert from "node:assert";
import {
  canAddCompetitor,
  detectCompetitorAlerts,
  benchmarkZoneReputation,
  MAX_TRACKED_COMPETITORS,
  type CompetitorSnapshot,
} from "../../src/lib/competitor-tracking";

function makeSnapshot(overrides: Partial<CompetitorSnapshot> = {}): CompetitorSnapshot {
  return {
    competitorId: "comp-1",
    competitorName: "Competidor A",
    capturedAt: "2026-07-01T00:00:00.000Z",
    source: "manual_checklist",
    priceCents: 7000,
    services: ["residential"],
    activePromotions: [],
    averageRating: 4.5,
    reviewCount: 50,
    zone: "richmond-central",
    ...overrides,
  };
}

describe("canAddCompetitor", () => {
  it("permite agregar bajo el tope de 10", () => {
    const r = canAddCompetitor(9);
    assert.equal(r.allowed, true);
  });

  it("bloquea al llegar al tope de 10", () => {
    const r = canAddCompetitor(MAX_TRACKED_COMPETITORS);
    assert.equal(r.allowed, false);
  });
});

describe("detectCompetitorAlerts", () => {
  it("competidor nuevo (no en lista conocida) genera alerta new_competitor", () => {
    const current = makeSnapshot();
    const alerts = detectCompetitorAlerts(current, null, []);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, "new_competitor");
  });

  it("competidor ya conocido, primer snapshot (previous=null), sin cambio de precio posible", () => {
    const current = makeSnapshot();
    const alerts = detectCompetitorAlerts(current, null, ["comp-1"]);
    assert.equal(alerts.length, 0);
  });

  it("cambio de precio >10% genera alerta price_change", () => {
    const previous = makeSnapshot({ priceCents: 7000 });
    const current = makeSnapshot({ priceCents: 8000 }); // +14.3%
    const alerts = detectCompetitorAlerts(current, previous, ["comp-1"]);
    assert.equal(alerts.some((a) => a.type === "price_change"), true);
  });

  it("cambio de precio <=10% NO genera alerta", () => {
    const previous = makeSnapshot({ priceCents: 7000 });
    const current = makeSnapshot({ priceCents: 7500 }); // +7.1%
    const alerts = detectCompetitorAlerts(current, previous, ["comp-1"]);
    assert.equal(alerts.some((a) => a.type === "price_change"), false);
  });

  it("baja de precio >10% tambien genera alerta (spec no distingue direccion)", () => {
    const previous = makeSnapshot({ priceCents: 8000 });
    const current = makeSnapshot({ priceCents: 6800 }); // -15%
    const alerts = detectCompetitorAlerts(current, previous, ["comp-1"]);
    assert.equal(alerts.some((a) => a.type === "price_change"), true);
  });

  it("caida de rating significativa con reseñas suficientes genera oportunidad", () => {
    const previous = makeSnapshot({ averageRating: 4.5, reviewCount: 80 });
    const current = makeSnapshot({ averageRating: 4.0, reviewCount: 85 });
    const alerts = detectCompetitorAlerts(current, previous, ["comp-1"]);
    assert.equal(alerts.some((a) => a.type === "reputation_opportunity"), true);
  });

  it("caida de rating con pocas reseñas NO genera oportunidad (ruido estadistico)", () => {
    const previous = makeSnapshot({ averageRating: 5.0, reviewCount: 2 });
    const current = makeSnapshot({ averageRating: 4.0, reviewCount: 3 });
    const alerts = detectCompetitorAlerts(current, previous, ["comp-1"]);
    assert.equal(alerts.some((a) => a.type === "reputation_opportunity"), false);
  });

  it("puede acumular varias alertas a la vez (precio + reputacion)", () => {
    const previous = makeSnapshot({ priceCents: 7000, averageRating: 4.5, reviewCount: 80 });
    const current = makeSnapshot({ priceCents: 8500, averageRating: 3.9, reviewCount: 85 });
    const alerts = detectCompetitorAlerts(current, previous, ["comp-1"]);
    const types = alerts.map((a) => a.type);
    assert.ok(types.includes("price_change"));
    assert.ok(types.includes("reputation_opportunity"));
  });
});

describe("benchmarkZoneReputation", () => {
  it("null cuando no hay competidores en la zona", () => {
    const r = benchmarkZoneReputation("richmond-central", 4.8, []);
    assert.equal(r, null);
  });

  it("calcula promedio de competidores y compara contra el nuestro", () => {
    const competitors = [
      makeSnapshot({ averageRating: 4.0 }),
      makeSnapshot({ competitorId: "comp-2", averageRating: 4.4 }),
    ];
    const r = benchmarkZoneReputation("richmond-central", 4.8, competitors);
    assert.ok(r);
    assert.equal(r!.competitorAverageRating, 4.2);
    assert.equal(r!.aheadOfCompetitors, true);
  });

  it("aheadOfCompetitors es false si estamos por debajo del promedio", () => {
    const competitors = [makeSnapshot({ averageRating: 4.9 })];
    const r = benchmarkZoneReputation("richmond-central", 4.5, competitors);
    assert.ok(r);
    assert.equal(r!.aheadOfCompetitors, false);
  });
});

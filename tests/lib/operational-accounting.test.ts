import { describe, it } from "node:test";
import assert from "node:assert";
import {
  summarizeByZone,
  summarizeByServiceType,
  summarizeByTeam,
  summarizeOverall,
  type OrderFinancialRecord,
} from "../../src/lib/operational-accounting";

const records: OrderFinancialRecord[] = [
  {
    orderId: "o1",
    zone: "Richmond",
    serviceType: "regular",
    teamLabel: "Equipo A",
    collectedCents: 20000,
    laborCostCents: 8000,
    employerBurdenCents: 1000,
  },
  {
    orderId: "o2",
    zone: "Richmond",
    serviceType: "deep",
    teamLabel: "Equipo A",
    collectedCents: 30000,
    laborCostCents: 15000,
    employerBurdenCents: 1500,
  },
  {
    orderId: "o3",
    zone: "North Vancouver",
    serviceType: "regular",
    teamLabel: "Equipo B",
    collectedCents: 25000,
    laborCostCents: 12000,
    employerBurdenCents: 1200,
    otherCostsCents: 500,
  },
];

describe("summarizeByZone", () => {
  it("agrupa cobrado/pagado/margenes por zona", () => {
    const result = summarizeByZone(records);
    const richmond = result.find((r) => r.key === "Richmond")!;
    assert.equal(richmond.orders, 2);
    assert.equal(richmond.collectedCents, 50000);
    assert.equal(richmond.laborCostCents, 23000);
    assert.equal(richmond.contributionMarginCents, 27000);
    assert.equal(richmond.netMarginCents, 27000 - 2500);
  });

  it("ordena de mayor a menor cobrado", () => {
    const result = summarizeByZone(records);
    assert.ok(result[0].collectedCents >= result[1].collectedCents);
  });
});

describe("summarizeByServiceType", () => {
  it("agrupa por tipo de servicio", () => {
    const result = summarizeByServiceType(records);
    const regular = result.find((r) => r.key === "regular")!;
    assert.equal(regular.orders, 2);
    assert.equal(regular.collectedCents, 45000);
  });
});

describe("summarizeByTeam", () => {
  it("agrupa por equipo", () => {
    const result = summarizeByTeam(records);
    const equipoA = result.find((r) => r.key === "Equipo A")!;
    assert.equal(equipoA.orders, 2);
    assert.equal(equipoA.collectedCents, 50000);
  });
});

describe("porcentajes de margen", () => {
  it("calcula el porcentaje sobre lo cobrado, no sobre lo pagado", () => {
    const result = summarizeByZone(records);
    const richmond = result.find((r) => r.key === "Richmond")!;
    assert.equal(richmond.contributionMarginPercent, 27000 / 50000);
  });

  it("evita division por cero cuando no hay cobro", () => {
    const zeroCollected: OrderFinancialRecord[] = [
      { orderId: "o4", zone: "Zona X", serviceType: "regular", teamLabel: "Equipo C", collectedCents: 0, laborCostCents: 5000, employerBurdenCents: 500 },
    ];
    const result = summarizeByZone(zeroCollected);
    assert.equal(result[0].contributionMarginPercent, 0);
    assert.equal(result[0].netMarginPercent, 0);
  });
});

describe("summarizeOverall", () => {
  it("suma todo en un solo total", () => {
    const total = summarizeOverall(records);
    assert.equal(total.orders, 3);
    assert.equal(total.collectedCents, 75000);
    assert.equal(total.laborCostCents, 35000);
    assert.equal(total.otherCostsCents, 500);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  simulateRevenueDropScenario,
  crossesMandatoryReviewThreshold,
  nextLeverToActivate,
  meetsExpansionReserveRule,
  STRESS_LEVERS_IN_ORDER,
} from "../../src/lib/financial-stress-scenario";

describe("simulateRevenueDropScenario", () => {
  it("aplica -30% de ingreso en los 3 meses", () => {
    const months = simulateRevenueDropScenario({
      currentMonthlyRevenueCents: 10000000,
      currentMonthlyFixedCostsCents: 3000000,
      currentMonthlyVariableCostsCents: 5000000,
    });
    assert.equal(months.length, 3);
    assert.equal(months[0].simulatedRevenueCents, 7000000);
    assert.equal(months[1].simulatedRevenueCents, 7000000);
    assert.equal(months[2].simulatedRevenueCents, 7000000);
  });

  it("escala costos variables proporcionalmente al ingreso caído", () => {
    const months = simulateRevenueDropScenario({
      currentMonthlyRevenueCents: 10000000,
      currentMonthlyFixedCostsCents: 0,
      currentMonthlyVariableCostsCents: 5000000, // ratio 0.5
    });
    // 7,000,000 * 0.5 = 3,500,000
    assert.equal(months[0].simulatedVariableCostsCents, 3500000);
  });

  it("marca isNegative correctamente cuando el margen cae bajo cero", () => {
    const months = simulateRevenueDropScenario({
      currentMonthlyRevenueCents: 10000000,
      currentMonthlyFixedCostsCents: 6000000,
      currentMonthlyVariableCostsCents: 5000000,
    });
    // revenue 7M - fixed 6M - variable 3.5M = -2.5M -> negativo
    assert.equal(months[0].isNegative, true);
  });
});

describe("crossesMandatoryReviewThreshold", () => {
  it("2 meses negativos SEGUIDOS cruza el umbral", () => {
    const months = [
      { monthIndex: 1, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: -1, isNegative: true },
      { monthIndex: 2, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: -1, isNegative: true },
      { monthIndex: 3, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: 1, isNegative: false },
    ];
    assert.equal(crossesMandatoryReviewThreshold(months), true);
  });

  it("2 meses negativos NO seguidos NO cruza el umbral", () => {
    const months = [
      { monthIndex: 1, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: -1, isNegative: true },
      { monthIndex: 2, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: 1, isNegative: false },
      { monthIndex: 3, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: -1, isNegative: true },
    ];
    assert.equal(crossesMandatoryReviewThreshold(months), false);
  });

  it("0 meses negativos no cruza el umbral", () => {
    const months = [
      { monthIndex: 1, simulatedRevenueCents: 0, simulatedVariableCostsCents: 0, simulatedNetMarginCents: 1, isNegative: false },
    ];
    assert.equal(crossesMandatoryReviewThreshold(months), false);
  });
});

describe("nextLeverToActivate", () => {
  it("ninguna activada -> devuelve la primera del orden fijo", () => {
    assert.equal(nextLeverToActivate([]), STRESS_LEVERS_IN_ORDER[0]);
  });

  it("nunca salta pasos: devuelve la siguiente en orden aunque una posterior ya esté 'activada'", () => {
    // Caso raro/inválido: alguien marcó la #3 sin la #1 ni #2 -- igual debe pedir la #1 primero.
    const r = nextLeverToActivate([STRESS_LEVERS_IN_ORDER[2]]);
    assert.equal(r, STRESS_LEVERS_IN_ORDER[0]);
  });

  it("todas activadas -> null", () => {
    assert.equal(nextLeverToActivate([...STRESS_LEVERS_IN_ORDER]), null);
  });
});

describe("meetsExpansionReserveRule", () => {
  it("cumple si el efectivo cubre 3 meses de fijos + 1 nómina quincenal", () => {
    const r = meetsExpansionReserveRule({
      currentCashOnHandCents: 10000000,
      monthlyFixedCostsCents: 2000000,
      biweeklyPayrollCents: 1000000,
    });
    // requerido = 6,000,000 + 1,000,000 = 7,000,000
    assert.equal(r.requiredCents, 7000000);
    assert.equal(r.meetsRule, true);
    assert.equal(r.shortfallCents, 0);
  });

  it("no cumple y reporta el faltante exacto", () => {
    const r = meetsExpansionReserveRule({
      currentCashOnHandCents: 5000000,
      monthlyFixedCostsCents: 2000000,
      biweeklyPayrollCents: 1000000,
    });
    assert.equal(r.meetsRule, false);
    assert.equal(r.shortfallCents, 2000000);
  });
});

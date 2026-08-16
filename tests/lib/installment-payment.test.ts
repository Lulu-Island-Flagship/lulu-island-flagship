import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isEligibleForInstallmentPlan,
  computeInstallmentSplit,
  computeInstallmentSecondDueDate,
  INSTALLMENT_ELIGIBILITY_THRESHOLD_CENTS,
  INSTALLMENT_SECOND_DUE_DAYS_BEFORE_SERVICE,
} from "../../src/lib/installment-payment";

describe("isEligibleForInstallmentPlan", () => {
  it("no elegible en exactamente $500", () => {
    assert.equal(isEligibleForInstallmentPlan(50000n), false);
  });
  it("elegible por encima de $500", () => {
    assert.equal(isEligibleForInstallmentPlan(50001n), true);
  });
  it("no elegible muy por debajo del umbral", () => {
    assert.equal(isEligibleForInstallmentPlan(10000n), false);
  });
  it("el umbral exportado es $500 en centavos", () => {
    assert.equal(INSTALLMENT_ELIGIBILITY_THRESHOLD_CENTS, 50000n);
  });
});

describe("computeInstallmentSplit", () => {
  it("divide 50/50 exacto en un total par", () => {
    const split = computeInstallmentSplit(80000n);
    assert.equal(split.firstInstallmentCents, 40000n);
    assert.equal(split.secondInstallmentCents, 40000n);
  });

  it("el primer pago absorbe el centavo extra en un total impar", () => {
    const split = computeInstallmentSplit(80001n);
    assert.equal(split.firstInstallmentCents, 40001n);
    assert.equal(split.secondInstallmentCents, 40000n);
    assert.equal(split.firstInstallmentCents + split.secondInstallmentCents, 80001n);
  });
});

describe("computeInstallmentSecondDueDate", () => {
  it("7 días antes del servicio cuando hay margen suficiente", () => {
    const due = computeInstallmentSecondDueDate("2026-08-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    assert.equal(due, "2026-07-25T00:00:00.000Z");
    assert.equal(INSTALLMENT_SECOND_DUE_DAYS_BEFORE_SERVICE, 7);
  });

  it("nunca declara una fecha ya pasada -- si el servicio es en menos de 7 días, vence ahora", () => {
    const due = computeInstallmentSecondDueDate("2026-07-03T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
    assert.equal(due, "2026-07-01T00:00:00.000Z");
  });
});

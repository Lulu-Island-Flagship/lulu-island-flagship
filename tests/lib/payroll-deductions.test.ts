import { describe, it } from "node:test";
import assert from "node:assert";
import {
  calculateCppContribution,
  calculateEiPremium,
  calculateWorkSafeBcPremium,
  calculateVacationPayAccrual,
  getVacationPayRate,
  calculatePayrollDeductions,
  CPP_RATE_2026,
  CPP_YMPE_2026,
  CPP2_RATE_2026,
  CPP_YAMPE_2026,
  EI_EMPLOYEE_RATE_2026,
  EI_MAX_INSURABLE_2026,
  WORKSAFEBC_AVG_BASE_RATE_2026,
} from "../../src/lib/payroll-deductions";

describe("calculateCppContribution", () => {
  it("aplica la exención básica prorrateada por período semi-mensual (24 períodos, no 26)", () => {
    const r = calculateCppContribution({ grossCents: 200000, ytdPensionableCents: 0 });
    const exemptionPerPeriod = Math.round((3500 * 100) / 24);
    const expectedBase = Math.round((200000 - exemptionPerPeriod) * CPP_RATE_2026);
    assert.equal(r.baseContributionCents, expectedBase);
    assert.equal(r.cpp2ContributionCents, 0);
  });

  it("deja de contribuir CPP base una vez alcanzado el YMPE acumulado", () => {
    const ympeCents = CPP_YMPE_2026 * 100;
    const r = calculateCppContribution({ grossCents: 500000, ytdPensionableCents: ympeCents });
    assert.equal(r.baseContributionCents, 0);
  });

  it("cobra CPP2 en la banda entre YMPE y YAMPE", () => {
    const ympeCents = CPP_YMPE_2026 * 100;
    const r = calculateCppContribution({ grossCents: 100000, ytdPensionableCents: ympeCents });
    assert.equal(r.cpp2ContributionCents, Math.round(100000 * CPP2_RATE_2026));
  });

  it("no cobra CPP2 mas alla del YAMPE acumulado", () => {
    const yampeCents = CPP_YAMPE_2026 * 100;
    const r = calculateCppContribution({ grossCents: 100000, ytdPensionableCents: yampeCents });
    assert.equal(r.cpp2ContributionCents, 0);
    assert.equal(r.baseContributionCents, 0);
  });

  it("acumula correctamente el ytdPensionableAfterCents", () => {
    const r = calculateCppContribution({ grossCents: 200000, ytdPensionableCents: 100000 });
    assert.equal(r.ytdPensionableAfterCents, 300000);
  });
});

describe("calculateEiPremium", () => {
  it("empleador paga 1.4x lo que paga el empleado", () => {
    const r = calculateEiPremium({ grossCents: 200000, ytdInsurableCents: 0 });
    assert.equal(r.employeeCents, Math.round(200000 * EI_EMPLOYEE_RATE_2026));
    assert.equal(r.employerCents, Math.round(r.employeeCents * 1.4));
  });

  it("deja de cobrar EI una vez alcanzado el maximo asegurable", () => {
    const maxCents = EI_MAX_INSURABLE_2026 * 100;
    const r = calculateEiPremium({ grossCents: 200000, ytdInsurableCents: maxCents });
    assert.equal(r.employeeCents, 0);
    assert.equal(r.employerCents, 0);
  });

  it("cobra solo la porcion restante hasta el maximo si el periodo lo cruza", () => {
    const maxCents = EI_MAX_INSURABLE_2026 * 100;
    const r = calculateEiPremium({ grossCents: 200000, ytdInsurableCents: maxCents - 100000 });
    assert.equal(r.employeeCents, Math.round(100000 * EI_EMPLOYEE_RATE_2026));
  });
});

describe("calculateWorkSafeBcPremium", () => {
  it("solo lo paga el empleador, usando la tasa promedio por defecto", () => {
    const r = calculateWorkSafeBcPremium({ grossCents: 200000, ytdAssessableCents: 0 });
    assert.equal(r.employerCents, Math.round(200000 * WORKSAFEBC_AVG_BASE_RATE_2026));
  });

  it("acepta una tasa personalizada por unidad de clasificacion", () => {
    const r = calculateWorkSafeBcPremium({ grossCents: 200000, ytdAssessableCents: 0, rate: 0.03 });
    assert.equal(r.employerCents, Math.round(200000 * 0.03));
  });

  it("respeta el tope anual de ganancias evaluables", () => {
    const r = calculateWorkSafeBcPremium({ grossCents: 200000, ytdAssessableCents: 127500 * 100 });
    assert.equal(r.employerCents, 0);
  });
});

describe("getVacationPayRate / calculateVacationPayAccrual", () => {
  it("4% con menos de 5 años de antiguedad", () => {
    assert.equal(getVacationPayRate(2), 0.04);
  });

  it("6% con 5 o mas años de antiguedad", () => {
    assert.equal(getVacationPayRate(5), 0.06);
    assert.equal(getVacationPayRate(10), 0.06);
  });

  it("calcula el monto acumulado correctamente", () => {
    assert.equal(calculateVacationPayAccrual(100000, 2), 4000);
    assert.equal(calculateVacationPayAccrual(100000, 6), 6000);
  });
});

describe("calculatePayrollDeductions", () => {
  it("arma el desglose completo y el neto estimado excluye impuesto (limitacion documentada)", () => {
    const r = calculatePayrollDeductions({
      grossCents: 200000,
      yearsOfService: 2,
      ytdPensionableCents: 0,
      ytdInsurableCents: 0,
      ytdAssessableCents: 0,
    });
    assert.equal(r.employeeDeductionsCents, r.cpp.totalContributionCents + r.ei.employeeCents);
    assert.equal(r.estimatedNetCents, r.grossCents - r.employeeDeductionsCents);
    assert.ok(r.employerCostCents > 0);
    assert.equal(r.vacationPayAccrualCents, 8000);
  });
});

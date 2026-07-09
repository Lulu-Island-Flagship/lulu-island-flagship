import { describe, it } from "node:test";
import assert from "node:assert";
import { buildCycleDeductions, cycleDeductionsToCsv, totalCycleDeductions } from "../../src/lib/payroll-export";
import type { EmployeeCycleSummary, PayrollCycle } from "../../src/lib/payroll-cycle";

const cycle: PayrollCycle = { start: "2026-07-01", end: "2026-07-15", label: "2026-07 Q1" };

const summaries: EmployeeCycleSummary[] = [
  {
    employeeId: "e1",
    employeeName: "Ana López",
    services: 5,
    baseCents: 100000,
    bonusCents: 0,
    penaltyCents: 0,
    reworkCents: 0,
    minWageAdjustmentCents: 0,
    grossCents: 100000,
  },
  {
    employeeId: "e2",
    employeeName: "Beto Ruiz",
    services: 3,
    baseCents: 60000,
    bonusCents: 0,
    penaltyCents: 0,
    reworkCents: 0,
    minWageAdjustmentCents: 0,
    grossCents: 60000,
  },
];

describe("buildCycleDeductions", () => {
  it("calcula deducciones por empleado usando su propio YTD y antigüedad", () => {
    const ytd = new Map([
      ["e1", { employeeId: "e1", ytdPensionableCents: 0, ytdInsurableCents: 0, ytdAssessableCents: 0 }],
      ["e2", { employeeId: "e2", ytdPensionableCents: 0, ytdInsurableCents: 0, ytdAssessableCents: 0 }],
    ]);
    const years = new Map([
      ["e1", 6],
      ["e2", 1],
    ]);
    const lines = buildCycleDeductions(summaries, ytd, years);
    assert.equal(lines.length, 2);
    // Ana (6 años) usa 6% de vacation pay, Beto (1 año) usa 4%
    assert.equal(lines[0].deductions.vacationPayAccrualCents, Math.round(100000 * 0.06));
    assert.equal(lines[1].deductions.vacationPayAccrualCents, Math.round(60000 * 0.04));
  });

  it("usa YTD en cero si el empleado no tiene snapshot (primer ciclo del año)", () => {
    const lines = buildCycleDeductions(summaries, new Map(), new Map());
    assert.equal(lines[0].deductions.cpp.ytdPensionableAfterCents, 100000);
  });
});

describe("cycleDeductionsToCsv", () => {
  it("genera un CSV con encabezado estable y todas las columnas de deducciones", () => {
    const lines = buildCycleDeductions(summaries, new Map(), new Map());
    const csv = cycleDeductionsToCsv(lines, cycle);
    const rows = csv.split("\n");
    assert.equal(rows.length, 3); // header + 2 empleados
    assert.match(rows[0], /^cycle,employee_id,employee_name,services,gross_cad,cpp_cad,cpp2_cad,ei_employee_cad,ei_employer_cad,worksafebc_employer_cad,vacation_pay_accrual_cad,estimated_net_cad,employer_cost_cad$/);
    assert.match(rows[1], /^2026-07 Q1,e1,"Ana López",5,/);
  });
});

describe("totalCycleDeductions", () => {
  it("suma los totales del ciclo completo", () => {
    const lines = buildCycleDeductions(summaries, new Map(), new Map());
    const totals = totalCycleDeductions(lines);
    assert.equal(totals.totalGrossCents, 160000);
    assert.equal(
      totals.totalCppCents,
      lines[0].deductions.cpp.totalContributionCents + lines[1].deductions.cpp.totalContributionCents
    );
  });
});

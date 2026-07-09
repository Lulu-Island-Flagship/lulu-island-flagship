/**
 * v8.3 E9 — Exportación de nómina completa (D.9): une el resumen del ciclo
 * quincenal (payroll-cycle.ts) con el desglose de deducciones canadienses
 * (payroll-deductions.ts) en un solo reporte por empleado, exportable a
 * CSV/QBO. Funciones puras: reciben los YTD ya leídos de la base de datos.
 */

import type { EmployeeCycleSummary, PayrollCycle } from "./payroll-cycle";
import { calculatePayrollDeductions, type PayrollDeductionsResult } from "./payroll-deductions";

export interface EmployeeYtdSnapshot {
  employeeId: string;
  ytdPensionableCents: number;
  ytdInsurableCents: number;
  ytdAssessableCents: number;
}

export interface EmployeeTenure {
  employeeId: string;
  yearsOfService: number;
}

export interface CycleDeductionLine {
  employeeId: string;
  employeeName: string;
  services: number;
  deductions: PayrollDeductionsResult;
}

const ZERO_YTD = { ytdPensionableCents: 0, ytdInsurableCents: 0, ytdAssessableCents: 0 };

/** Combina el resumen del ciclo con el desglose de deducciones, empleado por empleado. */
export function buildCycleDeductions(
  summaries: EmployeeCycleSummary[],
  ytdByEmployee: Map<string, EmployeeYtdSnapshot>,
  yearsOfServiceByEmployee: Map<string, number>
): CycleDeductionLine[] {
  return summaries.map((s) => {
    const ytd = ytdByEmployee.get(s.employeeId) ?? { employeeId: s.employeeId, ...ZERO_YTD };
    const yearsOfService = yearsOfServiceByEmployee.get(s.employeeId) ?? 0;
    const deductions = calculatePayrollDeductions({
      grossCents: s.grossCents,
      yearsOfService,
      ytdPensionableCents: ytd.ytdPensionableCents,
      ytdInsurableCents: ytd.ytdInsurableCents,
      ytdAssessableCents: ytd.ytdAssessableCents,
    });
    return { employeeId: s.employeeId, employeeName: s.employeeName, services: s.services, deductions };
  });
}

/** CSV con desglose completo — orden de columnas estable, consumible por QBO u hoja de cálculo. */
export function cycleDeductionsToCsv(lines: CycleDeductionLine[], cycle: PayrollCycle): string {
  const header = [
    "cycle",
    "employee_id",
    "employee_name",
    "services",
    "gross_cad",
    "cpp_cad",
    "cpp2_cad",
    "ei_employee_cad",
    "ei_employer_cad",
    "worksafebc_employer_cad",
    "vacation_pay_accrual_cad",
    "estimated_net_cad",
    "employer_cost_cad",
  ].join(",");

  const rows = lines.map((l) => {
    const d = l.deductions;
    return [
      cycle.label,
      l.employeeId,
      `"${l.employeeName.replace(/"/g, '""')}"`,
      l.services,
      (d.grossCents / 100).toFixed(2),
      (d.cpp.baseContributionCents / 100).toFixed(2),
      (d.cpp.cpp2ContributionCents / 100).toFixed(2),
      (d.ei.employeeCents / 100).toFixed(2),
      (d.ei.employerCents / 100).toFixed(2),
      (d.workSafeBc.employerCents / 100).toFixed(2),
      (d.vacationPayAccrualCents / 100).toFixed(2),
      (d.estimatedNetCents / 100).toFixed(2),
      (d.employerCostCents / 100).toFixed(2),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

/** Totales del ciclo completo (para el panel de contabilidad / resumen ejecutivo). */
export interface CycleDeductionTotals {
  totalGrossCents: number;
  totalCppCents: number;
  totalEiEmployeeCents: number;
  totalEiEmployerCents: number;
  totalWorkSafeBcCents: number;
  totalVacationPayAccrualCents: number;
  totalEstimatedNetCents: number;
  totalEmployerCostCents: number;
}

export function totalCycleDeductions(lines: CycleDeductionLine[]): CycleDeductionTotals {
  return lines.reduce(
    (acc, l) => {
      const d = l.deductions;
      acc.totalGrossCents += d.grossCents;
      acc.totalCppCents += d.cpp.totalContributionCents;
      acc.totalEiEmployeeCents += d.ei.employeeCents;
      acc.totalEiEmployerCents += d.ei.employerCents;
      acc.totalWorkSafeBcCents += d.workSafeBc.employerCents;
      acc.totalVacationPayAccrualCents += d.vacationPayAccrualCents;
      acc.totalEstimatedNetCents += d.estimatedNetCents;
      acc.totalEmployerCostCents += d.employerCostCents;
      return acc;
    },
    {
      totalGrossCents: 0,
      totalCppCents: 0,
      totalEiEmployeeCents: 0,
      totalEiEmployerCents: 0,
      totalWorkSafeBcCents: 0,
      totalVacationPayAccrualCents: 0,
      totalEstimatedNetCents: 0,
      totalEmployerCostCents: 0,
    } as CycleDeductionTotals
  );
}

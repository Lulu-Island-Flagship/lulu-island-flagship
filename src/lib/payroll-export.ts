/**
 * v8.3 E9 — Exportación de nómina completa (D.9): une el resumen del ciclo
 * quincenal (payroll-cycle.ts) con el desglose de deducciones canadienses
 * (payroll-deductions.ts) en un solo reporte por empleado, exportable a
 * CSV/QBO. Funciones puras: reciben los YTD ya leídos de la base de datos.
 *
 * Fix de auditoría E9: el export no incluía días trabajados / Day Rate /
 * minutos de rework pagados (el "factor" detrás del monto) -- se agregaron
 * reusando cálculos que ya existían (payroll.ts calculatePayroll,
 * payroll-cycle.ts aggregateCycle), sin inventar lógica nueva.
 *
 * PENDIENTE (fuera de alcance de este fix, requiere módulo nuevo):
 *  - Comisiones y propinas de empleado: no existe HOY ningún dato/tabla de
 *    comisiones o propinas por empleado en el esquema (partner-commissions.ts
 *    es un dominio distinto: comisiones a SOCIOS referentes, no a
 *    empleados). Agregar esto requeriría una tabla nueva + un punto de
 *    captura (dónde se registra la propina/comisión) antes de poder
 *    exportarla -- no es un campo derivable de cálculos existentes.
 *  - PDF de nómina, integración real QBO Payroll y firma digital real
 *    (Documenso/DocuSign): alcance mayor, no cubierto aquí.
 *
 * v8.3 P0-8 (auditoría Fable5, 2026-07-19): se agrega soporte OPCIONAL de
 * SIN descifrado al export (attachSinToLines / cycleDeductionsToCsvWithSin).
 * Es una capa aparte de buildCycleDeductions/cycleDeductionsToCsv (que NO
 * se tocan, para no romper el contrato/tests existentes del CSV base) --
 * el caller (payroll-export/route.ts) decide si la llama, y solo debe
 * hacerlo tras descifrar el SIN vía get_employee_banking_info() (RPC,
 * migración 204), que ya exige rol owner_admin por su cuenta. Esta capa
 * nunca toca la base de datos ni el cifrado -- son funciones puras que
 * reciben el SIN ya en texto plano y solo lo insertan en la fila/CSV.
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
  /** v8.3 fix auditoría E9: pasa a través del EmployeeCycleSummary del
   * ciclo (payroll-cycle.ts) -- días trabajados, Day Rate total y minutos
   * de rework pagados, para que el reporte exportable de nómina no se
   * quede solo con las deducciones canadienses. */
  daysWorked: number;
  dayRateCents: number;
  reworkPaidMinutesTotal: number;
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
    return {
      employeeId: s.employeeId,
      employeeName: s.employeeName,
      services: s.services,
      deductions,
      daysWorked: s.daysWorked,
      dayRateCents: s.dayRateCents,
      reworkPaidMinutesTotal: s.reworkPaidMinutesTotal,
    };
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
    "days_worked",
    "day_rate_cad",
    "rework_paid_minutes",
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
      l.daysWorked,
      (l.dayRateCents / 100).toFixed(2),
      l.reworkPaidMinutesTotal,
    ].join(",");
  });

  return [header, ...rows].join("\n");
}

/**
 * v8.3 P0-8: fila de export con SIN en texto plano adjunto. Tipo separado
 * (no se agrega `sin` a CycleDeductionLine) para que quede explícito en el
 * sistema de tipos cuándo una lista de líneas SÍ trae el dato más sensible
 * de todo el sistema de nómina, y para que sea imposible pasarla por error
 * a cycleDeductionsToCsv() (el CSV base, sin SIN, sigue exactamente igual).
 */
export interface CycleDeductionLineWithSin extends CycleDeductionLine {
  /** SIN en texto plano, ya descifrado por get_employee_banking_info(). null si el empleado aún no tiene SIN capturado. */
  sin: string | null;
}

/** Adjunta el SIN (ya descifrado por el caller vía RPC) a cada línea. Función pura -- no descifra nada aquí. */
export function attachSinToLines(
  lines: CycleDeductionLine[],
  sinByEmployee: Map<string, string | null>
): CycleDeductionLineWithSin[] {
  return lines.map((l) => ({ ...l, sin: sinByEmployee.get(l.employeeId) ?? null }));
}

/**
 * CSV con SIN incluido -- SOLO debe generarse cuando el caller ya verificó
 * que quien pide el export es owner_admin (ver payroll-export/route.ts,
 * resource 'payroll' en admin-rbac.ts está restringido a owner_admin).
 * Nunca usar esta función para una respuesta que no vaya a manos del propio
 * flujo de nómina -- el SIN es información regulada (CRA T4).
 */
export function cycleDeductionsToCsvWithSin(lines: CycleDeductionLineWithSin[], cycle: PayrollCycle): string {
  const baseCsv = cycleDeductionsToCsv(lines, cycle);
  const baseRows = baseCsv.split("\n");
  const header = `${baseRows[0]},sin`;
  const rows = lines.map((l, i) => `${baseRows[i + 1]},${l.sin ?? ""}`);
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

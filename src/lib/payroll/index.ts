// ─── Barrel: Payroll ──────────────────────────────────────────
// v8.3 H7 (auditoría 2026-08-06): punto de entrada canónico para
// el subsistema de nómina. Preferir este barrel sobre imports
// individuales a archivos payroll-*.ts.
//
//   import { calculatePayroll, BC_MIN_WAGE_HOURLY } from "@/lib/payroll";
//
// Los imports directos a archivos individuales (ej. "@/lib/payroll-engine")
// siguen funcionando por compatibilidad, pero el barrel es el camino
// recomendado para código nuevo.

// ─── Cálculo por servicio ──────────────────────────────────────
export {
  calculatePayroll,
  calculateOvertimePay,
  BC_MIN_WAGE_HOURLY,
  DEFAULT_SERVICE_MINUTES,
  dollarsToCents,
  centsToDollars,
  serviceResultToLaborEvent,
} from "../payroll";
export type { PayrollCalculationInput, PayrollCalculationResult } from "../payroll";

// ─── Engine multi-ciclo ────────────────────────────────────────
export {
  createPayrollCycle,
  isValidTransition,
  transitionCycle,
  updateCycleTotals,
  generatePayrollJournalEntry,
  VALID_TRANSITIONS,
  payrollCicloSchema,
  PAYROLL_CHART_OF_ACCOUNTS,
} from "../payroll-engine";
export type {
  PayrollCycleStatus,
  PayrollCiclo,
  CreatePayrollCycleInput,
  PayrollCuentaContable,
  PayrollDisbursementEvent,
  PayrollJournalRow,
  PayrollJournalInput,
} from "../payroll-engine";

// ─── Deductions (CPP, EI, tax) ─────────────────────────────────
export {
  calculatePayrollDeductions,
  PAY_PERIODS_PER_YEAR,
  CPP_RATE_2026,
  EI_EMPLOYEE_RATE_2026,
} from "../payroll-deductions";
export type { PayrollDeductionsInput, PayrollDeductionsResult } from "../payroll-deductions";

// ─── Bridge (despacho → nómina) ────────────────────────────────
export {
  emitirHorasRegistradas,
  servicioCompletadoToHheObservation,
} from "../payroll-bridge";
export type { ServicioCompletado, PayrollBridgeResult } from "../payroll-bridge";

// ─── Line utilities ────────────────────────────────────────────
export { maskSin, centsToDollars as formatCentsToDollars } from "../payroll-line";

// ─── Cycle management ──────────────────────────────────────────
export {
  getCycleForDate,
  getPreviousCycle,
  aggregateCycle,
  cycleToCsv,
} from "../payroll-cycle";
export type { PayrollCycle, EmployeeCycleSummary, CycleEntry } from "../payroll-cycle";

// ─── Export / reporting ────────────────────────────────────────
export {
  buildCycleDeductions,
  cycleDeductionsToCsv,
  cycleDeductionsToCsvWithSin,
  attachSinToLines,
  totalCycleDeductions,
} from "../payroll-export";
export type {
  CycleDeductionLine,
  CycleDeductionLineWithSin,
  CycleDeductionTotals,
  EmployeeYtdSnapshot,
  EmployeeTenure,
} from "../payroll-export";

// ─── Persistence ───────────────────────────────────────────────
export { insertPayrollEntry } from "../payroll-persist";
export type { InsertPayrollEntryInput, InsertPayrollEntryResult } from "../payroll-persist";

// ─── Constants ─────────────────────────────────────────────────
export { PAY_PERIODS_PER_YEAR as PAYROLL_PERIODS_PER_YEAR } from "../payroll-constants";

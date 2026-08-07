// ─── Tipos: Nómina (Módulo 2) ─────────────────────────────────
// Extraídos de src/types/index.ts — auditoría H1 (2026-08-06).

import type { Employee } from "./employee";

export interface PayrollEntry {
  id: string;
  employeeId: string;
  orderId: string;
  assignmentId?: string;
  dayRate: number;
  estimatedServiceMinutes: number;
  reworkMinutes: number;
  qcScore?: number;
  baseAmount: number;
  qcBonusAmount: number;
  qcPenaltyAmount: number;
  reworkPaidMinutes: number;
  reworkAmount: number;
  hourlyEquivalent: number;
  minimumWageAdjustment: number;
  grossAmount: number;
  status: "pending" | "approved" | "paid" | "disputed" | "cancelled";
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollSettings {
  id: string;
  bcMinWageHourly: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── EmployeePayrollConfig (configuración de nómina por empleado) ─
// v8.3 H3 (auditoría 2026-08-06): separado de Employee para que
// las funciones de nómina reciban solo lo que necesitan, sin
// acoplarse a los atributos personales del empleado.
// dayRate está en DÓLARES; convertir a centavos para cálculos.

export interface EmployeePayrollConfig {
  /** Day rate en DÓLARES (INTEGER, ej. 200 = $200/día). */
  dayRate: number;
  /** Minutos base del horario (modelo 70/30). */
  baseScheduleMinutes: number;
  /** Minutos de contingencia (modelo 70/30). */
  contingencyMinutes: number;
  /** Si está activada la protección de salario mínimo (BC ESA). */
  minWageFloorEnabled: boolean;
  /** Umbral de score QC para bonus/penalty (0-100). */
  qcScoreThreshold: number;
  /** Bonus en centavos por punto sobre el umbral QC. */
  qcBonusPerPoint: number;
  /** Minutos máximos de rework pagado por servicio. */
  maxReworkMinutes: number;
}

// ─── EmployeeWithPayroll (vista compuesta) ─────────────────────

export interface EmployeeWithPayroll extends Employee, EmployeePayrollConfig {}

/**
 * v8.4 Capa 4 del Financial Core — Payroll Chart of Accounts.
 *
 * Define las cuentas contables específicas de nómina que extienden el Chart
 * of Accounts base del Financial Ledger. Cada cuenta es un código de 4 dígitos
 * sin guiones (misma convención que chart-of-accounts.ts).
 *
 * Pasivos (2xxx):
 *   - 2200: CPP por Pagar (employee + employer)
 *   - 2300: EI por Pagar (employee + employer)
 *   - 2400: Impuestos Retenidos por Pagar (federal + provincial)
 *   - 2500: WorkSafeBC por Pagar
 *   - 2600: Vacation Pay Acumulado (pasivo)
 *
 * Gastos (6xxx):
 *   - 6100: Gasto de Nómina (gross pay)
 *   - 6200: Gasto de Cargas Patronales (CPP employer + EI employer + WorkSafeBC)
 *
 * Extraído de payroll-engine.ts (Paso A — god-object decomposition).
 */

import type { CuentaContable } from "./financial-ledger";

/** Códigos de cuenta contable para nómina — extienden el Chart of Accounts base.
 *
 * Formato unificado: 4 dígitos sin guiones (misma convención que chart-of-accounts.ts).
 * Anteriormente usaba "X-XXXX" con guiones; ahora todos los códigos son "XXXX".
 */
export const PAYROLL_CHART_OF_ACCOUNTS = {
  /** Pasivo — CPP por Pagar (employee + employer contributions pendientes de remesar a CRA). */
  CPP_POR_PAGAR: "2200",
  /** Pasivo — EI por Pagar (employee + employer premiums pendientes de remesar a CRA). */
  EI_POR_PAGAR: "2300",
  /** Pasivo — Impuestos Retenidos por Pagar (federal + provincial tax withholdings). */
  IMPUESTOS_RETENIDOS_POR_PAGAR: "2400",
  /** Pasivo — WorkSafeBC por Pagar (employer premium pendiente). */
  WORKSAFEBC_POR_PAGAR: "2500",
  /** Pasivo — Vacation Pay Acumulado (accrual pendiente de pago al empleado). */
  VACATION_PAY_POR_PAGAR: "2600",
  /** Gasto — Nómina bruta del período (gross pay a empleados). */
  GASTO_NOMINA: "6100",
  /** Gasto — Cargas Patronales (CPP employer + EI employer + WorkSafeBC). */
  GASTO_CARGAS_PATRONALES: "6200",
} as const;

/** Todas las cuentas contables (base + payroll). */
export type PayrollCuentaContable = CuentaContable | (typeof PAYROLL_CHART_OF_ACCOUNTS)[keyof typeof PAYROLL_CHART_OF_ACCOUNTS];

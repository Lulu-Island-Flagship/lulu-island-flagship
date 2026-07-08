/**
 * v8.3 E2/E9 — CICLO QUINCENAL de nómina (invariante B.1: pago quincenal,
 * direct deposit). Funciones puras, fechas en hora Vancouver (YYYY-MM-DD).
 * Convención semi-mensual estándar: día 1-15 y día 16-fin de mes.
 */

export interface PayrollCycle {
  /** YYYY-MM-DD inclusive */
  start: string;
  /** YYYY-MM-DD inclusive */
  end: string;
  /** ej. "2026-07 Q1" (1-15) / "2026-07 Q2" (16-fin) */
  label: string;
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Ciclo quincenal al que pertenece una fecha (YYYY-MM-DD). */
export function getCycleForDate(dateStr: string): PayrollCycle {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Fecha inválida: ${dateStr}`);
  if (d <= 15) {
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15`, label: `${y}-${pad(m)} Q1` };
  }
  return {
    start: `${y}-${pad(m)}-16`,
    end: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`,
    label: `${y}-${pad(m)} Q2`,
  };
}

/** Ciclo quincenal ANTERIOR al de la fecha dada (el que se paga). */
export function getPreviousCycle(dateStr: string): PayrollCycle {
  const current = getCycleForDate(dateStr);
  const [y, m] = dateStr.split("-").map(Number);
  if (current.label.endsWith("Q2")) {
    return getCycleForDate(`${y}-${pad(m)}-01`);
  }
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return getCycleForDate(`${prevY}-${pad(prevM)}-16`);
}

// ------------------------------------------------------------
// Agregación del ciclo (entradas → resumen por empleado)
// ------------------------------------------------------------

export interface CycleEntry {
  employeeId: string;
  employeeName: string;
  sinLast3?: string; // solo últimos 3 dígitos en exports no oficiales
  serviceDate: string;
  baseAmountCents: number;
  bonusCents: number;
  penaltyCents: number;
  reworkAmountCents: number;
  minimumWageAdjustmentCents: number;
  grossAmountCents: number;
}

export interface EmployeeCycleSummary {
  employeeId: string;
  employeeName: string;
  services: number;
  baseCents: number;
  bonusCents: number;
  penaltyCents: number;
  reworkCents: number;
  minWageAdjustmentCents: number;
  grossCents: number;
}

export function aggregateCycle(entries: CycleEntry[], cycle: PayrollCycle): EmployeeCycleSummary[] {
  const inCycle = entries.filter((e) => e.serviceDate >= cycle.start && e.serviceDate <= cycle.end);
  const byEmp = new Map<string, EmployeeCycleSummary>();
  for (const e of inCycle) {
    const s =
      byEmp.get(e.employeeId) ??
      byEmp
        .set(e.employeeId, {
          employeeId: e.employeeId,
          employeeName: e.employeeName,
          services: 0,
          baseCents: 0,
          bonusCents: 0,
          penaltyCents: 0,
          reworkCents: 0,
          minWageAdjustmentCents: 0,
          grossCents: 0,
        })
        .get(e.employeeId)!;
    s.services += 1;
    s.baseCents += e.baseAmountCents;
    s.bonusCents += e.bonusCents;
    s.penaltyCents += e.penaltyCents;
    s.reworkCents += e.reworkAmountCents;
    s.minWageAdjustmentCents += e.minimumWageAdjustmentCents;
    s.grossCents += e.grossAmountCents;
  }
  return Array.from(byEmp.values()).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** Export CSV del ciclo (orden de columnas estable — consumible por QBO u hoja de cálculo). */
export function cycleToCsv(summaries: EmployeeCycleSummary[], cycle: PayrollCycle): string {
  const header = "cycle,employee_id,employee_name,services,base_cad,bonus_cad,penalty_cad,rework_cad,min_wage_adjustment_cad,gross_cad";
  const rows = summaries.map((s) =>
    [
      cycle.label,
      s.employeeId,
      `"${s.employeeName.replace(/"/g, '""')}"`,
      s.services,
      (s.baseCents / 100).toFixed(2),
      (s.bonusCents / 100).toFixed(2),
      (s.penaltyCents / 100).toFixed(2),
      (s.reworkCents / 100).toFixed(2),
      (s.minWageAdjustmentCents / 100).toFixed(2),
      (s.grossCents / 100).toFixed(2),
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

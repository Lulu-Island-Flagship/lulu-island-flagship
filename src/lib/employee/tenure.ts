/**
 * v8.3 "Esponja" (auditoría 2026-08-06) — Helpers de antigüedad.
 *
 * Centraliza el cálculo de años de servicio a partir de `employees.hire_date`
 * (expuesto como `Employee.hireDate` en `@/types/employee`). Antes de esto,
 * cada consumidor (payroll-export, sick-leave, statutory-holiday-scan, ROE)
 * calculaba la antigüedad por su cuenta con fórmulas duplicadas y sin un
 * punto único de verdad.
 *
 * Usar `computeYearsOfService(hireDate, asOf?)` en vez de hacer la división
 * manual `(today - hire) / (365.25 * 86400000)`.
 */

/**
 * Calcula los años de servicio completos (redondeo hacia abajo) entre
 * `hireDate` (YYYY-MM-DD) y `asOf` (Date, default: hoy).
 *
 * - Si `hireDate` es nulo, vacío, o inválido, devuelve 0.
 * - El resultado es siempre un entero no negativo.
 * - Usa 365.25 días/año para compensar años bisiestos, igual que el resto
 *   del sistema (ver src/app/api/admin/payroll-export/route.ts y
 *   src/lib/career-path.ts).
 *
 * @example
 *   computeYearsOfService("2022-03-15")                          // ~3 (desde 2022-03-15 hasta hoy)
 *   computeYearsOfService("2022-03-15", new Date("2026-08-01"))  // 4
 *   computeYearsOfService(null)                                   // 0
 *   computeYearsOfService("")                                     // 0
 */
export function computeYearsOfService(
  hireDate: string | null | undefined,
  asOf: Date = new Date(),
): number {
  if (!hireDate) return 0;

  const hire = new Date(`${hireDate}T00:00:00Z`);
  if (isNaN(hire.getTime())) return 0;

  const diffMs = asOf.getTime() - hire.getTime();
  if (diffMs <= 0) return 0;

  const years = diffMs / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, Math.floor(years));
}

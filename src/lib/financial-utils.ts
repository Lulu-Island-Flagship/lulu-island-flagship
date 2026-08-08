// ─── Utilidades financieras compartidas ───────────────────────────────
//
// Extraído de src/lib/employee-financial-dashboard.ts (auditoría 2026-08-07)
// para que payroll-ytd-dashboard.ts no dependa del módulo de dashboard de
// empleado (dependency inversion).
//
// Contenido:
//   assertSingleEmployee — guardia de privacidad (un solo employee_id)
//   formatCents          — formateo de centavos a string $XX.XX

/**
 * Escanea un array de objetos que tengan `employeeId` y lanza si encuentra
 * más de un employeeId distinto. Fail-closed: ante cualquier ambigüedad,
 * bloquea. Este es el cortafuegos de runtime que garantiza que ningún dato
 * de otro empleado se cuele en el dashboard.
 *
 * Mismo patrón que `assertNoIndividualIdentifier` en team-ranking.ts.
 */
export function assertSingleEmployee(
  items: ReadonlyArray<{ employeeId: string }>,
  context: string,
): void {
  const ids = new Set(items.map((i) => i.employeeId));
  if (ids.size > 1) {
    throw new Error(
      `F.5 PRIVACY VIOLATION: ${context} contains ${ids.size} distinct employee_ids. ` +
        `Employee financial dashboard must only show data for ONE employee. ` +
        `Caller must filter by authenticated employee_id before calling this module.`,
    );
  }
}

/** Convierte centavos a string con formato $XX.XX. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

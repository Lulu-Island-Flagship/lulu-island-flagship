/**
 * v8.3 E8.14 — Rotación de compañeros: "mínimo 3 distintos por mes;
 * excepción 'nunca juntos' documentada; conflicto con idioma/zona → decide
 * admin."
 *
 * Funciones puras: no tocan la base de datos. El caller (ruta admin) arma
 * `AssignmentPair[]` a partir de `assignments` agrupadas por order_id (dos
 * empleados en la misma orden = trabajaron juntos ese día) y
 * `PairingException[]` desde employee_pairing_exceptions.
 */

export const MIN_DISTINCT_COWORKERS_PER_MONTH = 3;

/** Un par de empleados que compartieron una orden en una fecha dada. */
export interface AssignmentPair {
  employeeAId: string;
  employeeBId: string;
  orderId: string;
  serviceDate: string; // YYYY-MM-DD
}

export interface PairingException {
  employeeAId: string;
  employeeBId: string;
  reason: string;
}

export interface CoworkerRotationStatus {
  employeeId: string;
  distinctCoworkerIds: string[];
  distinctCount: number;
  compliant: boolean;
}

export interface PairingExceptionViolation {
  employeeAId: string;
  employeeBId: string;
  reason: string;
  orderIds: string[];
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Por cada empleado presente en `pairs`, cuenta compañeros DISTINTOS con los
 * que compartió al menos una orden en el período (el caller ya filtró
 * `pairs` al mes correspondiente). compliant = distinctCount >=
 * MIN_DISTINCT_COWORKERS_PER_MONTH.
 */
export function computeRotationStatus(pairs: AssignmentPair[]): CoworkerRotationStatus[] {
  const coworkersByEmployee = new Map<string, Set<string>>();

  function addCoworker(employeeId: string, coworkerId: string) {
    if (!coworkersByEmployee.has(employeeId)) {
      coworkersByEmployee.set(employeeId, new Set());
    }
    coworkersByEmployee.get(employeeId)!.add(coworkerId);
  }

  for (const pair of pairs) {
    addCoworker(pair.employeeAId, pair.employeeBId);
    addCoworker(pair.employeeBId, pair.employeeAId);
  }

  return Array.from(coworkersByEmployee.entries()).map(([employeeId, coworkers]) => ({
    employeeId,
    distinctCoworkerIds: Array.from(coworkers),
    distinctCount: coworkers.size,
    compliant: coworkers.size >= MIN_DISTINCT_COWORKERS_PER_MONTH,
  }));
}

/**
 * Cruza los pares reales del mes contra las excepciones "nunca juntos"
 * documentadas -- si el dispatch los juntó de todas formas, es una
 * violación que el admin debe revisar (conflicto de idioma/zona ya
 * documentado como excepción, pero el sistema de despacho no lo respetó).
 */
export function detectPairingExceptionViolations(
  pairs: AssignmentPair[],
  exceptions: PairingException[]
): PairingExceptionViolation[] {
  const exceptionMap = new Map<string, PairingException>();
  for (const exc of exceptions) {
    exceptionMap.set(pairKey(exc.employeeAId, exc.employeeBId), exc);
  }

  const violationsByPair = new Map<string, PairingExceptionViolation>();

  for (const pair of pairs) {
    const key = pairKey(pair.employeeAId, pair.employeeBId);
    const exc = exceptionMap.get(key);
    if (!exc) continue;

    if (!violationsByPair.has(key)) {
      violationsByPair.set(key, {
        employeeAId: exc.employeeAId,
        employeeBId: exc.employeeBId,
        reason: exc.reason,
        orderIds: [],
      });
    }
    violationsByPair.get(key)!.orderIds.push(pair.orderId);
  }

  return Array.from(violationsByPair.values());
}

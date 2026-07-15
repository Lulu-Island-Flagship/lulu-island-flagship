/**
 * v8.3 E9.4 — "WorkSafeBC (... certificaciones con vencimiento y bloqueo)"
 * y D.9 Doc 3 / E7 — "certificación química 3 niveles progresivos ...
 * no asignable sin vigencia."
 *
 * Lógica pura: dado el registro de certificaciones de un empleado, decide
 * si está vigente y si por tanto puede seguir siendo asignado a servicios.
 * El bloqueo real (excluir del despacho) vive en el cron
 * dispatch-scheduler, siguiendo el mismo patrón ya usado para seguro
 * vehicular vencido (v8.3 E7, migración 047) -- nunca se reimplementa esa
 * decisión aquí, solo se replica la forma.
 */

export type CertificationLevel = 1 | 2 | 3;

export interface EmployeeCertificationRecord {
  level: CertificationLevel;
  expiresAtISO: string;
  revokedAtISO: string | null;
}

export type CertificationStatus = "valid" | "expiring_soon" | "expired" | "revoked" | "none";

/** Ventana de aviso antes del vencimiento (D.9: certificaciones con vencimiento). */
export const CERTIFICATION_EXPIRING_SOON_DAYS = 30;

export function computeCertificationStatus(
  record: EmployeeCertificationRecord | null,
  todayISO: string
): CertificationStatus {
  if (!record) return "none";
  if (record.revokedAtISO) return "revoked";

  const today = new Date(todayISO).getTime();
  const expires = new Date(record.expiresAtISO).getTime();
  if (today >= expires) return "expired";

  const warnAt = new Date(record.expiresAtISO);
  warnAt.setUTCDate(warnAt.getUTCDate() - CERTIFICATION_EXPIRING_SOON_DAYS);
  if (today >= warnAt.getTime()) return "expiring_soon";

  return "valid";
}

/**
 * Un empleado es asignable si tiene AL MENOS una certificación de
 * manejo químico vigente (no vencida, no revocada). "expiring_soon" sigue
 * siendo asignable (solo bloquea al vencer de verdad, punto B.3.1-style:
 * no penalizar antes de tiempo).
 */
export function isEmployeeAssignableByCertification(
  records: EmployeeCertificationRecord[],
  todayISO: string
): boolean {
  if (records.length === 0) return false;
  return records.some((r) => {
    const status = computeCertificationStatus(r, todayISO);
    return status === "valid" || status === "expiring_soon";
  });
}

/** Certificación de mayor nivel vigente hoy (para mostrar qué puede hacer el empleado), o null si ninguna. */
export function highestValidCertificationLevel(
  records: EmployeeCertificationRecord[],
  todayISO: string
): CertificationLevel | null {
  const validLevels = records
    .filter((r) => {
      const status = computeCertificationStatus(r, todayISO);
      return status === "valid" || status === "expiring_soon";
    })
    .map((r) => r.level);
  if (validLevels.length === 0) return null;
  return Math.max(...validLevels) as CertificationLevel;
}

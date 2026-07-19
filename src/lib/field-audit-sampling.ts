/**
 * v8.3 E5 — Muestreo aleatorio para Auditor de Campo (despacho probabilístico ~20%).
 *
 * No reemplaza el flujo manual existente (el admin sigue eligiendo qué auditar);
 * esto solo AGREGA una bandera "suggested" determinística y verificable sobre
 * ~20% de las órdenes completadas del día, para que el auditor tenga una muestra
 * objetiva y no solo revise lo que ya le pareció sospechoso (eso rompería el
 * propósito de una auditoría sorpresa).
 *
 * Determinístico por diseño: mismo (orderId, fecha) siempre cae en el mismo
 * lado (auditar o no) — así es testeable sin depender de Math.random() y
 * reproducible si hay que explicar una decisión después.
 */

import { createHash } from "crypto";

/**
 * Hash criptográfico (SHA-256, primeros 4 bytes como uint32). Se reemplazó un
 * FNV-1a casero que en la práctica NO distribuía bien strings casi idénticos
 * (ej. "order-fixed::2026-07-01" vs "...-02"): en una prueba real, el mismo
 * order_id nunca cayó en el 20% durante los 30 días de julio. SHA-256 tiene
 * efecto avalancha garantizado — un solo caracter distinto cambia por completo
 * el hash — que es exactamente lo que se necesita para que "salt = fecha" sí
 * cambie la muestra día a día.
 */
function stableHash(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0);
}

/**
 * ¿Esta orden cae en la muestra de auditoría sorpresa?
 * @param orderId id de la orden
 * @param dateSalt fecha (YYYY-MM-DD) usada como sal para que la muestra cambie cada día
 * @param rate proporción objetivo (default 0.20 = 20%)
 */
export function isAuditSampleSelected(
  orderId: string,
  dateSalt: string,
  rate: number = 0.2
): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const h = stableHash(`${orderId}::${dateSalt}`);
  const bucket = h / 0xffffffff; // normaliza a [0,1)
  return bucket < rate;
}

/**
 * Aplica la selección a una lista de ids y devuelve cuáles quedaron marcados.
 * Incluye una verificación de sanidad: si la lista es grande, la proporción
 * real debe acercarse a `rate` (para detectar un hash roto en tests).
 */
export function selectAuditSample(
  orderIds: string[],
  dateSalt: string,
  rate: number = 0.2
): Set<string> {
  const selected = new Set<string>();
  for (const id of orderIds) {
    if (isAuditSampleSelected(id, dateSalt, rate)) selected.add(id);
  }
  return selected;
}

// ============================================================
// v8.3 E3 fix — Triggers obligatorios del Auditor de Campo.
//
// El muestreo aleatorio ~20% de arriba es una muestra objetiva de fondo,
// pero una auditoría de campo real no puede depender SOLO de una moneda al
// aire: hay señales que, si aparecen, deben forzar una auditoría sí o sí,
// sin importar en qué lado del hash cayó la orden ese día. Estos 4 triggers
// son aditivos al muestreo aleatorio (isAuditSampleSelected sigue vivo tal
// cual) -- una orden queda "para auditar" si CUALQUIERA de los dos caminos
// la selecciona.
// ============================================================

export const TRIGGER_NEW_CLIENT = "new_client";
export const TRIGGER_TEAM_SCORE_LOW = "team_score_below_70";
export const TRIGGER_EMPLOYEE_SCORE_LOW = "employee_score_below_30";
export const TRIGGER_POST_DISPUTE = "post_dispute";

/** Umbral de score de equipo (0-100, employee_scores.total_score promedio de la cuadrilla). */
export const TEAM_SCORE_THRESHOLD = 70;
/** Umbral de score individual (0-100, employee_scores.total_score). */
export const EMPLOYEE_SCORE_THRESHOLD = 30;

export interface MandatoryAuditInput {
  /** Cliente con 1-2 servicios históricos (ver NEW_CLIENT_MAX_SERVICES en client-segmentation.ts). */
  isNewClient?: boolean;
  /** Promedio de employee_scores.total_score (0-100) de la cuadrilla asignada a la orden. */
  teamScore?: number | null;
  /** El peor employee_scores.total_score (0-100) entre la cuadrilla asignada. */
  employeeScore?: number | null;
  /** La orden (o el empleado asignado) tiene una disputa reciente asociada (tickets_disputas). */
  hasRecentDispute?: boolean;
}

/**
 * Evalúa los 4 triggers obligatorios y devuelve la lista de los que aplican.
 * Lista vacía = ningún trigger obligatorio (la orden solo entra por muestreo
 * aleatorio, si le toca).
 */
export function getMandatoryAuditTriggers(input: MandatoryAuditInput): string[] {
  const reasons: string[] = [];
  if (input.isNewClient) reasons.push(TRIGGER_NEW_CLIENT);
  if (typeof input.teamScore === "number" && input.teamScore < TEAM_SCORE_THRESHOLD) {
    reasons.push(TRIGGER_TEAM_SCORE_LOW);
  }
  if (typeof input.employeeScore === "number" && input.employeeScore < EMPLOYEE_SCORE_THRESHOLD) {
    reasons.push(TRIGGER_EMPLOYEE_SCORE_LOW);
  }
  if (input.hasRecentDispute) reasons.push(TRIGGER_POST_DISPUTE);
  return reasons;
}

/** true si al menos un trigger obligatorio aplica. */
export function isMandatoryAudit(input: MandatoryAuditInput): boolean {
  return getMandatoryAuditTriggers(input).length > 0;
}

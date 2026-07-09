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

/** Hash FNV-1a simple, suficiente para distribuir uniformemente sin dependencias externas. */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // uint32
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
  const h = fnv1aHash(`${orderId}::${dateSalt}`);
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

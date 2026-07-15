/**
 * v8.3 E10.3 — SEO local + Google Business Profile: lógica pura de estado
 * del checklist. Sigue el mismo patrón que dr-drill.ts (intervalos
 * requeridos por frecuencia + nowIso explícito, sin new Date() interno).
 */

export type GbpFrequency = "once" | "weekly" | "quarterly";

export const GBP_FREQUENCY_INTERVAL_DAYS: Record<GbpFrequency, number> = {
  once: Infinity, // nunca vence una vez completado
  weekly: 7,
  quarterly: 91,
};

export type GbpChecklistItem = {
  itemKey: string;
  frequency: GbpFrequency;
  lastCompletedAt: string | null; // ISO
};

export type GbpItemStatus = "never_done" | "ok" | "due_soon" | "overdue";

const DUE_SOON_WINDOW_DAYS = 2;

/** Estado de un ítem individual del checklist, dado "ahora" explícito. */
export function computeGbpItemStatus(item: GbpChecklistItem, nowIso: string): GbpItemStatus {
  if (!item.lastCompletedAt) {
    return "never_done";
  }
  const intervalDays = GBP_FREQUENCY_INTERVAL_DAYS[item.frequency];
  if (intervalDays === Infinity) {
    return "ok";
  }
  const now = new Date(nowIso).getTime();
  const last = new Date(item.lastCompletedAt).getTime();
  const daysSince = (now - last) / (1000 * 60 * 60 * 24);
  if (daysSince > intervalDays) {
    return "overdue";
  }
  if (daysSince > intervalDays - DUE_SOON_WINDOW_DAYS) {
    return "due_soon";
  }
  return "ok";
}

export function computeAllGbpItemStatuses(
  items: GbpChecklistItem[],
  nowIso: string
): Array<GbpChecklistItem & { status: GbpItemStatus }> {
  return items.map((item) => ({ ...item, status: computeGbpItemStatus(item, nowIso) }));
}

/** Verificación NAP trimestral: ¿está vencida dado el último check registrado? */
export function isNapCheckOverdue(lastCheckedAtIso: string | null, nowIso: string): boolean {
  if (!lastCheckedAtIso) return true;
  const now = new Date(nowIso).getTime();
  const last = new Date(lastCheckedAtIso).getTime();
  const daysSince = (now - last) / (1000 * 60 * 60 * 24);
  return daysSince > GBP_FREQUENCY_INTERVAL_DAYS.quarterly;
}

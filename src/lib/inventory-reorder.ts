/**
 * v8.3 E7 (D.7.6) — Lógica pura de reposición de inventario.
 * "stock < umbral -> PO generada -> aprobación de un toque".
 * Esta función solo decide SI hace falta una PO; la aprobación sigue siendo
 * humana (un clic), nunca automática.
 */

export interface InventoryItemStock {
  id: string;
  name: string;
  currentStock: number;
  reorderThreshold: number;
}

export interface ReorderSuggestion {
  itemId: string;
  itemName: string;
  currentStock: number;
  reorderThreshold: number;
  deficit: number;
}

/** ¿Este item está bajo el umbral de reposición? */
export function needsReorder(item: InventoryItemStock): boolean {
  return item.currentStock < item.reorderThreshold;
}

/** Filtra y calcula el déficit de todos los items que necesitan PO. */
export function computeReorderSuggestions(items: InventoryItemStock[]): ReorderSuggestion[] {
  return items
    .filter(needsReorder)
    .map((item) => ({
      itemId: item.id,
      itemName: item.name,
      currentStock: item.currentStock,
      reorderThreshold: item.reorderThreshold,
      deficit: Math.max(0, item.reorderThreshold - item.currentStock),
    }))
    .sort((a, b) => b.deficit - a.deficit);
}

/**
 * Genera el texto de motivo para una PO automática (D.7.6): "Para 10 Deep esta
 * semana: 3L desengrasante, 50 paños. Stock: 2L. Alerta" — formato similar.
 */
export function formatReorderReason(s: ReorderSuggestion): string {
  return `${s.itemName}: stock ${s.currentStock} bajo el umbral de ${s.reorderThreshold} (déficit ${s.deficit}).`;
}

export const PO_REMINDER_HOURS = 48;
export const PO_STOCKOUT_ALERT_HOURS = 72;

/** ¿Ya pasó el umbral de horas para mandar el recordatorio de 48h? */
export function isReminderDue(createdAtIso: string, nowIso: string, hours: number = PO_REMINDER_HOURS): boolean {
  const created = new Date(createdAtIso).getTime();
  const now = new Date(nowIso).getTime();
  const elapsedHours = (now - created) / (1000 * 60 * 60);
  return elapsedHours >= hours;
}

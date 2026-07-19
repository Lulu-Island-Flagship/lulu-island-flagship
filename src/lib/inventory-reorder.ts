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

/**
 * v8.3 E7 fix de auditoría — hasta acá `needsReorder`/`computeReorderSuggestions`
 * solo comparaban stock actual contra un umbral fijo, ignorando por completo
 * `inventory_items.consumption_per_service` (migración 048, ej:
 * {"deep": 0.3, "regular": 0.1} litros por servicio). El spec pide poder
 * proyectar el consumo esperado de los servicios YA agendados esta semana
 * ("Para 10 Deep esta semana: 3L desengrasante. Stock: 2L. Alerta") y no
 * solo reaccionar cuando el stock ya cayó bajo el umbral fijo. Estas
 * funciones agregan esa proyección como una señal ADICIONAL a
 * needsReorder/computeReorderSuggestions (que se mantienen intactas para el
 * caso simple stock < umbral).
 */

/** Cuántos servicios de cada tipo (ej. "deep", "regular") ya están agendados en la ventana proyectada. */
export interface UpcomingServiceCount {
  serviceType: string;
  count: number;
}

export interface InventoryItemWithConsumption extends InventoryItemStock {
  unit: string;
  /** ej: {"deep": 0.3, "regular": 0.1} -- unidades del item por servicio de ese tipo. */
  consumptionPerService: Record<string, number>;
}

export interface ConsumptionBreakdownLine {
  serviceType: string;
  count: number;
  unitsPerService: number;
  subtotal: number;
}

export interface ConsumptionProjection {
  itemId: string;
  itemName: string;
  unit: string;
  currentStock: number;
  /** Consumo total proyectado en la ventana, sumando todos los tipos de servicio agendados. */
  projectedConsumption: number;
  breakdown: ConsumptionBreakdownLine[];
  /** max(0, proyectado - stock actual): cuánto faltaría si nada se repone antes. */
  projectedDeficit: number;
}

/** Proyecta el consumo de UN item contra los servicios agendados en la ventana (ej. próximos 7 días). */
export function computeConsumptionProjection(
  item: InventoryItemWithConsumption,
  upcomingServices: UpcomingServiceCount[]
): ConsumptionProjection {
  const breakdown: ConsumptionBreakdownLine[] = upcomingServices
    .map((s) => {
      const unitsPerService = item.consumptionPerService[s.serviceType] ?? 0;
      return { serviceType: s.serviceType, count: s.count, unitsPerService, subtotal: unitsPerService * s.count };
    })
    .filter((line) => line.unitsPerService > 0 && line.count > 0);

  const projectedConsumption = breakdown.reduce((sum, line) => sum + line.subtotal, 0);

  return {
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    currentStock: item.currentStock,
    projectedConsumption,
    breakdown,
    projectedDeficit: Math.max(0, projectedConsumption - item.currentStock),
  };
}

/** Proyecta el consumo de todos los items con receta de consumo definida, ordenado por déficit descendente. */
export function computeConsumptionProjections(
  items: InventoryItemWithConsumption[],
  upcomingServices: UpcomingServiceCount[]
): ConsumptionProjection[] {
  return items
    .map((item) => computeConsumptionProjection(item, upcomingServices))
    .filter((p) => p.breakdown.length > 0)
    .sort((a, b) => b.projectedDeficit - a.projectedDeficit);
}

/**
 * Texto de alerta por consumo proyectado, formato del spec: "Para 10 Deep
 * esta semana: 3L desengrasante. Stock: 2L. Alerta". Solo agrega el
 * sufijo "Alerta" cuando el stock actual no alcanza para cubrir lo proyectado.
 */
export function formatConsumptionAlert(p: ConsumptionProjection): string {
  const parts = p.breakdown
    .map((line) => `${line.count} ${line.serviceType}`)
    .join(", ");
  const base = `Para ${parts} esta semana: ${p.projectedConsumption}${p.unit} ${p.itemName}. Stock: ${p.currentStock}${p.unit}.`;
  return p.projectedDeficit > 0 ? `${base} Alerta` : base;
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

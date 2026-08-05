import {
  type InventoryItemWithConsumption,
  type UpcomingServiceCount,
  type ConsumptionProjection,
  computeConsumptionProjections,
} from "./inventory-reorder";
import {
  type SystemEvent,
  type CampaaBloqueadaPayload,
  type CampaaActivadaPayload,
  buildSystemEvent,
} from "./events";

/**
 * v8.3 C.3 — Candado Marketing → Inventario: bloquea la activación de
 * cualquier campaña de marketing sin una proyección de inventario a 14 días
 * que confirme stock suficiente.
 *
 * El spec es explícito (H.8): "Cada campaña requiere verificación de stock
 * antes de activarse". La ventana de proyección son 14 días naturales desde
 * la fecha de activación propuesta.
 *
 * Flujo:
 *   1. Marketing intenta activar campaña → llama a este módulo.
 *   2. El módulo proyecta el consumo de todos los items con receta SOP para
 *      los próximos 14 días de servicios agendados.
 *   3. Si TODOS los items pasan → campaña se activa, se emite
 *      `campaña.activada`.
 *   4. Si ALGÚN item no pasa → campaña se bloquea, se emite
 *      `campaña.bloqueada` con el detalle de items en déficit.
 *
 * Responsabilidades:
 *   - campaign-inventory-lock.ts: solo decide si bloquear o permitir.
 *   - inventory-reorder.ts: proyecta consumo (ya existe, no se modifica).
 *   - El caller (ruta de activación de campaña) aplica la decisión.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

/** Ventana de proyección de inventario para campañas (14 días según spec). */
export const CAMPAIGN_INVENTORY_PROJECTION_DAYS = 14;

/**
 * Margen de tolerancia: una campaña se aprueba si el stock proyectado cubre
 * al menos el 100% del consumo esperado. No hay buffer adicional porque el
 * propósito del candado es evitar rotura de stock, no optimizar margen.
 */
export const CAMPAIGN_STOCK_COVERAGE_REQUIRED = 1.0;

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Datos mínimos que identifican una campaña. */
export interface CampaignReference {
  /** ID único de la campaña en la base de datos. */
  campaignId: string;
  /** Nombre legible (ej. "Spring Cleaning Marzo 2026"). */
  campaignName: string;
  /** Fecha propuesta de activación (YYYY-MM-DD). */
  fechaActivacionPropuesta: string;
}

/** Item que no pasa la verificación de stock para la campaña. */
export interface CampaignDeficitItem {
  itemId: string;
  itemName: string;
  deficitProyectado: number;
  unit: string;
  consumoProyectado: number;
  stockActual: number;
}

/** Resultado de la verificación de campaña. */
export interface CampaignInventoryLockResult {
  /** true si la campaña puede activarse (todos los items pasan). */
  aprobada: boolean;
  /** Razón legible del resultado. */
  razon: string;
  /** Items que están en déficit (vacío si aprobada). */
  itemsEnDeficit: CampaignDeficitItem[];
  /** Proyecciones completas de todos los items evaluados. */
  proyecciones: ConsumptionProjection[];
  /** Evento emitido (campaña.activada o campaña.bloqueada). */
  evento: SystemEvent;
}

// ── Verificación de campaña ─────────────────────────────────────────────────

/**
 * Verifica si una campaña puede activarse dado el inventario actual y los
 * servicios agendados en los próximos 14 días.
 *
 * @param campaign — referencia de la campaña que se intenta activar.
 * @param itemsInventario — items con receta de consumo por tipo de servicio.
 * @param serviciosProyectados — conteo de servicios agendados en los próximos 14 días.
 * @returns CampaignInventoryLockResult con la decisión.
 */
export function verificarActivacionCampaa(
  campaign: CampaignReference,
  itemsInventario: InventoryItemWithConsumption[],
  serviciosProyectados: UpcomingServiceCount[],
): CampaignInventoryLockResult {
  const proyecciones = computeConsumptionProjections(itemsInventario, serviciosProyectados);

  const itemsEnDeficit: CampaignDeficitItem[] = [];

  for (const proj of proyecciones) {
    const deficit = Math.max(0, proj.projectedConsumption - proj.currentStock);
    if (deficit > 0) {
      itemsEnDeficit.push({
        itemId: proj.itemId,
        itemName: proj.itemName,
        deficitProyectado: Math.round(deficit * 100) / 100,
        unit: proj.unit,
        consumoProyectado: proj.projectedConsumption,
        stockActual: proj.currentStock,
      });
    }
  }

  const aprobada = itemsEnDeficit.length === 0;
  const correlationId = crypto.randomUUID();

  if (aprobada) {
    const payload: CampaaActivadaPayload = {
      campaign_id: campaign.campaignId,
      campaign_name: campaign.campaignName,
      stock_verificado_ok: true,
      fecha_activacion: new Date().toISOString(),
    };

    const evento = buildSystemEvent(
      "campaña.activada",
      campaign.campaignId,
      correlationId,
      payload,
    );

    return {
      aprobada: true,
      razon: `Campaña "${campaign.campaignName}" verificada: stock suficiente para ${CAMPAIGN_INVENTORY_PROJECTION_DAYS} días. Activación permitida.`,
      itemsEnDeficit: [],
      proyecciones,
      evento,
    };
  }

  // Bloqueada
  const payload: CampaaBloqueadaPayload = {
    campaign_id: campaign.campaignId,
    campaign_name: campaign.campaignName,
    items_en_deficit: itemsEnDeficit.map((d) => ({
      item_id: d.itemId,
      item_name: d.itemName,
      deficit_proyectado: d.deficitProyectado,
    })),
    ventana_proyeccion_dias: CAMPAIGN_INVENTORY_PROJECTION_DAYS,
  };

  const evento = buildSystemEvent(
    "campaña.bloqueada",
    campaign.campaignId,
    correlationId,
    payload,
  );

  const detalle = itemsEnDeficit
    .map((d) => `  - ${d.itemName}: necesita ${d.consumoProyectado}${d.unit}, hay ${d.stockActual}${d.unit} (déficit ${d.deficitProyectado}${d.unit})`)
    .join("\n");

  return {
    aprobada: false,
    razon: `Campaña "${campaign.campaignName}" BLOQUEADA: ${itemsEnDeficit.length} item(s) con stock insuficiente para ${CAMPAIGN_INVENTORY_PROJECTION_DAYS} días:\n${detalle}`,
    itemsEnDeficit,
    proyecciones,
    evento,
  };
}

/**
 * Verificación rápida: ¿puede esta campaña activarse?
 * No genera eventos — útil para previsualizar en el dashboard de marketing
 * sin disparar escrituras.
 *
 * @returns true si la campaña pasa la verificación de stock.
 */
export function campaaPuedeActivarse(
  itemsInventario: InventoryItemWithConsumption[],
  serviciosProyectados: UpcomingServiceCount[],
): boolean {
  if (itemsInventario.length === 0) return true; // sin items que verificar = pasa
  const proyecciones = computeConsumptionProjections(itemsInventario, serviciosProyectados);
  return proyecciones.every((p) => p.currentStock >= p.projectedConsumption);
}

/**
 * Genera un mensaje legible para el admin explicando por qué una campaña
 * fue bloqueada, listo para mostrar en la UI de marketing.
 */
export function formatearRazonBloqueo(result: CampaignInventoryLockResult): string {
  if (result.aprobada) return result.razon;

  const lines = [
    `⛔ Campaña bloqueada: ${result.itemsEnDeficit.length} items sin stock suficiente.`,
    "",
    "Items en déficit:",
    ...result.itemsEnDeficit.map(
      (d) => `  • ${d.itemName}: déficit de ${d.deficitProyectado}${d.unit} (stock: ${d.stockActual}${d.unit}, necesita: ${d.consumoProyectado}${d.unit})`
    ),
    "",
    `Ventana de proyección: ${CAMPAIGN_INVENTORY_PROJECTION_DAYS} días.`,
    "Acción sugerida: generar PO para los items en déficit y reintentar activación.",
  ];

  return lines.join("\n");
}

// ── Calendario de campañas pre-cargado (H.8) ────────────────────────────────

/**
 * Calendario de campañas estacionales para Richmond, BC.
 * El spec H.8 define estas campañas pre-cargadas. Cada una debe pasar por
 * el candado de inventario antes de activarse.
 */
export const CAMPAAS_ESTACIONALES_RICHMOND: Omit<CampaignReference, "fechaActivacionPropuesta">[] = [
  { campaignId: "spring-cleaning", campaignName: "Spring Cleaning — Marzo" },
  { campaignId: "may-move-out", campaignName: "Move-out — Mayo" },
  { campaignId: "vacation-rental", campaignName: "Vacation Rental — Julio/Agosto" },
  { campaignId: "pre-holiday-deep", campaignName: "Pre-Holiday Deep — Octubre" },
  { campaignId: "gift-cards-recovery", campaignName: "Gift Cards + Recovery — Diciembre" },
];

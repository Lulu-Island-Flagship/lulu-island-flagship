import {
  type InventoryItemWithConsumption,
  type InventoryItemStock,
  type UpcomingServiceCount,
  computeConsumptionProjection,
} from "./inventory-reorder";
import {
  type SystemEvent,
  type InventarioStockInsuficientePayload,
  type InventarioPoUrgentePayload,
  buildSystemEvent,
} from "./events";

/**
 * v8.3 C.2 — Gate Inventario ↔ Despacho: antes de asignar equipo a un
 * servicio, verifica que el stock cubra el consumo SOP proyectado más un
 * buffer del 20%. Si el stock es insuficiente, genera una de tres acciones:
 *
 *   1. PO urgente (cuando ningún alternativo cubre).
 *   2. Equipo alternativo (cuando existe un sustituto con stock suficiente).
 *   3. Alerta admin (cuando la decisión requiere juicio humano).
 *
 * Responsabilidades:
 *   - inventory-reorder.ts: proyecta consumo y detecta déficits.
 *   - inventory-dispatch-gate.ts: decide si se puede despachar y qué acción tomar.
 *   - El caller (ruta de asignación de despacho) aplica la decisión.
 *
 * Este módulo es el guardián que evita que un equipo salga a campo sin los
 * insumos necesarios — un error que hoy es silencioso (el empleado llega
 * al sitio y descubre que falta producto).
 */

// ── Constantes ───────────────────────────────────────────────────────────────

/** Buffer de seguridad sobre el consumo SOP proyectado (20% según spec). */
export const SOP_BUFFER_PERCENT = 0.2;

/** Cuántos días hacia adelante se proyecta el consumo para despachos. */
export const DESPACHO_PROJECTION_DAYS = 7;

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Resultado de la verificación para UN item de inventario. */
export interface ItemGateResult {
  itemId: string;
  itemName: string;
  unit: string;
  /** Stock disponible al momento de la verificación. */
  stockActual: number;
  /** Consumo SOP proyectado (sin buffer). */
  consumoSop: number;
  /** Consumo con buffer 20%. */
  consumoConBuffer: number;
  /** Cuánto falta para cubrir SOP + buffer. 0 o negativo = suficiente. */
  deficit: number;
  /** true si el stock alcanza para cubrir SOP + buffer. */
  suficiente: boolean;
}

/** Acción que toma el gate cuando un item no pasa la verificación. */
export type GateAction =
  | { tipo: "po_urgente"; itemId: string; itemName: string; deficit: number; motivo: string }
  | { tipo: "equipo_alternativo"; itemId: string; itemName: string; alternativoId: string; alternativoName: string }
  | { tipo: "alerta_admin"; itemId: string; itemName: string; deficit: number; motivo: string };

/** Resultado completo de la verificación de inventario para un despacho. */
export interface DispatchGateResult {
  /** true si TODOS los items pasan la verificación. */
  aprobado: boolean;
  /** Resultado individual por item. */
  items: ItemGateResult[];
  /** Ítems que no pasaron la verificación. */
  insuficientes: ItemGateResult[];
  /** Acciones correctivas generadas. */
  acciones: GateAction[];
  /** Eventos emitidos (uno por cada item insuficiente + uno por cada PO urgente). */
  eventos: SystemEvent[];
}

// ── Núcleo: verificación por item ────────────────────────────────────────────

/**
 * Verifica si UN item de inventario tiene stock suficiente para cubrir el
 * consumo SOP proyectado más un buffer del 20%.
 *
 * @param item — item de inventario con receta de consumo por tipo de servicio.
 * @param serviciosProyectados — conteo de servicios agendados en la ventana.
 * @returns ItemGateResult con el déficit calculado.
 */
export function verificarItemParaDespacho(
  item: InventoryItemWithConsumption,
  serviciosProyectados: UpcomingServiceCount[],
): ItemGateResult {
  const proyeccion = computeConsumptionProjection(item, serviciosProyectados);
  const consumoSop = proyeccion.projectedConsumption;
  const consumoConBuffer = consumoSop * (1 + SOP_BUFFER_PERCENT);
  const deficit = Math.max(0, consumoConBuffer - item.currentStock);

  return {
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    stockActual: item.currentStock,
    consumoSop,
    consumoConBuffer: Math.round(consumoConBuffer * 100) / 100,
    deficit: Math.round(deficit * 100) / 100,
    suficiente: deficit <= 0,
  };
}

// ── Núcleo: verificación completa del despacho ──────────────────────────────

/**
 * Verifica TODOS los items necesarios para un despacho contra el stock
 * disponible. Esta es la función principal que el asignador de despacho
 * debe llamar ANTES de confirmar la asignación de equipo.
 *
 * @param itemsConsumibles — items de inventario con receta de consumo (los que el SOP requiere).
 * @param serviciosProyectados — servicios agendados en la ventana de proyección (7 días).
 * @param alternativas — mapeo opcional de item_id → item_id alternativo (ej. guante látex → guante nitrilo).
 * @param orderId — ID de la orden para correlacionar eventos.
 * @returns DispatchGateResult con la decisión completa.
 */
export function verificarInventarioParaDespacho(
  itemsConsumibles: InventoryItemWithConsumption[],
  serviciosProyectados: UpcomingServiceCount[],
  alternativas?: Map<string, { id: string; name: string }>,
  orderId?: string,
): DispatchGateResult {
  const items = itemsConsumibles.map((item) =>
    verificarItemParaDespacho(item, serviciosProyectados),
  );

  const insuficientes = items.filter((i) => !i.suficiente);
  const acciones: GateAction[] = [];
  const eventos: SystemEvent[] = [];
  const correlationId = crypto.randomUUID();

  for (const insuf of insuficientes) {
    const alternativo = alternativas?.get(insuf.itemId);

    if (alternativo) {
      // Opción 2: hay un equipo/producto alternativo registrado.
      acciones.push({
        tipo: "equipo_alternativo",
        itemId: insuf.itemId,
        itemName: insuf.itemName,
        alternativoId: alternativo.id,
        alternativoName: alternativo.name,
      });
    } else {
      // Sin alternativo: verificar si el déficit es "menor" (alerta admin)
      // o "mayor" (PO urgente automática).
      // Heurística: si el consumo con buffer es > 2× el stock → PO urgente.
      const esCritico = insuf.consumoConBuffer > insuf.stockActual * 2;

      if (esCritico) {
        // Opción 1: PO urgente automática.
        const motivo = `${insuf.itemName}: stock ${insuf.stockActual}${insuf.itemId.includes("L") ? "L" : "u"} no alcanza para cubrir consumo proyectado de ${insuf.consumoConBuffer}${insuf.itemId.includes("L") ? "L" : "u"} (SOP + 20% buffer). Déficit: ${insuf.deficit}.`;
        acciones.push({
          tipo: "po_urgente",
          itemId: insuf.itemId,
          itemName: insuf.itemName,
          deficit: insuf.deficit,
          motivo,
        });

        // Emitir evento inventario.stock_insuficiente
        const payloadInsuf: InventarioStockInsuficientePayload = {
          item_id: insuf.itemId,
          item_name: insuf.itemName,
          stock_actual: insuf.stockActual,
          consumo_proyectado: insuf.consumoSop,
          buffer_percent: SOP_BUFFER_PERCENT,
          deficit: insuf.deficit,
          accion_sugerida: "po_urgente",
          equipo_alternativo_id: null,
        };
        eventos.push(
          buildSystemEvent(
            "inventario.stock_insuficiente",
            orderId ?? insuf.itemId,
            correlationId,
            payloadInsuf,
          ),
        );

        // Emitir evento inventario.po_urgente
        const payloadPo: InventarioPoUrgentePayload = {
          item_id: insuf.itemId,
          item_name: insuf.itemName,
          deficit: insuf.deficit,
          motivo,
          generada_automaticamente: true,
        };
        eventos.push(
          buildSystemEvent(
            "inventario.po_urgente",
            orderId ?? insuf.itemId,
            correlationId,
            payloadPo,
          ),
        );
      } else {
        // Opción 3: alerta admin (déficit moderado, requiere juicio humano).
        acciones.push({
          tipo: "alerta_admin",
          itemId: insuf.itemId,
          itemName: insuf.itemName,
          deficit: insuf.deficit,
          motivo: `${insuf.itemName}: déficit moderado de ${insuf.deficit} — revisar antes de despachar.`,
        });

        const payloadInsuf: InventarioStockInsuficientePayload = {
          item_id: insuf.itemId,
          item_name: insuf.itemName,
          stock_actual: insuf.stockActual,
          consumo_proyectado: insuf.consumoSop,
          buffer_percent: SOP_BUFFER_PERCENT,
          deficit: insuf.deficit,
          accion_sugerida: "alerta_admin",
          equipo_alternativo_id: null,
        };
        eventos.push(
          buildSystemEvent(
            "inventario.stock_insuficiente",
            orderId ?? insuf.itemId,
            correlationId,
            payloadInsuf,
          ),
        );
      }
    }
  }

  return {
    aprobado: insuficientes.length === 0,
    items,
    insuficientes,
    acciones,
    eventos,
  };
}

/**
 * Verificación rápida: ¿hay ALGÚN item crítico sin stock suficiente?
 * Útil para el dashboard de semáforos — no genera eventos, solo responde sí/no.
 *
 * @returns true si todos los items pasan, false si al menos uno no.
 */
export function despachoPuedeProceder(
  itemsConsumibles: InventoryItemWithConsumption[],
  serviciosProyectados: UpcomingServiceCount[],
): boolean {
  return itemsConsumibles.every((item) => {
    const result = verificarItemParaDespacho(item, serviciosProyectados);
    return result.suficiente;
  });
}

// ── Verificación clásica (stock simple, sin receta de consumo) ──────────────

/**
 * Verificación alternativa para items SIN receta de consumo por tipo de
 * servicio — solo compara stock actual contra umbral fijo + buffer.
 * Útil para items genéricos (ej. bolsas de basura, guantes) donde no hay
 * una proyección SOP por tipo de servicio sino un umbral mínimo.
 */
export function verificarItemSimpleParaDespacho(
  item: InventoryItemStock,
  bufferPercent: number = SOP_BUFFER_PERCENT,
): ItemGateResult {
  const umbralConBuffer = item.reorderThreshold * (1 + bufferPercent);
  const deficit = Math.max(0, umbralConBuffer - item.currentStock);

  return {
    itemId: item.id,
    itemName: item.name,
    unit: "u",
    stockActual: item.currentStock,
    consumoSop: item.reorderThreshold,
    consumoConBuffer: Math.round(umbralConBuffer * 100) / 100,
    deficit: Math.round(deficit * 100) / 100,
    suficiente: deficit <= 0,
  };
}

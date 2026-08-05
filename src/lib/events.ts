import { z } from "zod";

/**
 * v8.3 — Schemas Zod canónicos para todos los eventos del sistema.
 *
 * Cada evento comparte un envelope estándar (event_id UUIDv4, aggregate_id,
 * timestamp ISO8601, correlation_id, event_type discriminado, payload
 * validado). Los payloads se definen por separado para que cada módulo
 * emisor pueda validar su propia carga sin depender del envelope completo.
 *
 * Convención de nomenclatura: `dominio.accion` en snake_case, ej.
 * `empleado.horas_registradas`, `inventario.stock_insuficiente`.
 */

// ── Primitivos reutilizables ────────────────────────────────────────────────

/** UUID v4 (RFC 4122) — 8-4-4-4-12 hex. */
export const uuidv4Schema = z
  .string()
  .uuid("event_id debe ser UUID v4")
  .describe("Identificador único del evento (UUID v4)");

/** ISO 8601 con zona o UTC — ej. "2026-08-04T14:30:00.000Z" */
export const isoTimestampSchema = z
  .string()
  .datetime({ message: "timestamp debe ser ISO8601 con zona o UTC" })
  .describe("Timestamp del evento en formato ISO8601");

/** Correlation ID — conecta eventos dentro de un mismo flujo de negocio. */
export const correlationIdSchema = z
  .string()
  .min(1, "correlation_id no puede estar vacío")
  .describe("Identificador de correlación que agrupa eventos del mismo flujo");

// ── Payloads de dominio ─────────────────────────────────────────────────────

/** Emitido por payroll-bridge.ts cuando un despacho completa y registra horas reales. */
export const empleadoHorasRegistradasPayloadSchema = z.object({
  order_id: z.string().min(1).describe("ID de la orden de servicio"),
  employee_id: z.string().min(1).describe("ID del empleado que ejecutó el servicio"),
  horas_reales: z.number().positive("horas_reales debe ser > 0").describe("Horas-hombre reales consumidas (normalizado)"),
  zonas_completadas: z
    .array(z.string().min(1))
    .min(1, "Debe haber al menos una zona completada")
    .describe("Lista de zonas completadas durante el servicio"),
  fecha_servicio: isoTimestampSchema.describe("Fecha en que se ejecutó el servicio"),
});

/** Emitido por inventory-dispatch-gate.ts cuando el stock no alcanza para cubrir SOP + buffer. */
export const inventarioStockInsuficientePayloadSchema = z.object({
  item_id: z.string().min(1).describe("ID del item de inventario"),
  item_name: z.string().min(1).describe("Nombre legible del item"),
  stock_actual: z.number().min(0).describe("Stock disponible al momento de la verificación"),
  consumo_proyectado: z.number().positive().describe("Consumo SOP proyectado para el servicio"),
  buffer_percent: z.number().min(0).max(1).describe("Buffer aplicado (fracción, ej. 0.20 = 20%)"),
  deficit: z.number().positive("deficit debe ser > 0").describe("Cuánto falta para cubrir SOP + buffer"),
  /** Acción sugerida por el gate. */
  accion_sugerida: z.enum(["po_urgente", "equipo_alternativo", "alerta_admin"]),
  equipo_alternativo_id: z.string().nullable().describe("ID del equipo alternativo sugerido, si aplica"),
});

/** Emitido por campaign-inventory-lock.ts cuando una campaña se bloquea por inventario insuficiente. */
export const campaaBloqueadaPayloadSchema = z.object({
  campaign_id: z.string().min(1).describe("ID de la campaña bloqueada"),
  campaign_name: z.string().min(1).describe("Nombre de la campaña"),
  items_en_deficit: z
    .array(
      z.object({
        item_id: z.string().min(1),
        item_name: z.string().min(1),
        deficit_proyectado: z.number().positive(),
      })
    )
    .min(1, "Debe haber al menos un item en déficit"),
  ventana_proyeccion_dias: z.number().positive().describe("Días de proyección usados para la verificación"),
});

/** Emitido por campaign-inventory-lock.ts cuando una campaña pasa la verificación y se activa. */
export const campaaActivadaPayloadSchema = z.object({
  campaign_id: z.string().min(1).describe("ID de la campaña activada"),
  campaign_name: z.string().min(1).describe("Nombre de la campaña"),
  stock_verificado_ok: z.boolean().describe("Confirmación de que el stock pasó la verificación de 14 días"),
  fecha_activacion: isoTimestampSchema.describe("Momento en que se activó la campaña"),
});

/** Emitido por weather-dispatch-gate.ts cuando hay alerta de clima severo que pausa autopilot. */
export const climaAlertaSeveraPayloadSchema = z.object({
  zona: z.string().min(1).describe("Zona del área de servicio afectada"),
  condicion: z.string().min(1).describe("Condición climática adversa detectada (ej. nevada, viento fuerte)"),
  nivel: z.enum(["warning", "watch", "advisory"]).describe("Nivel de la alerta meteorológica"),
  /** true → pausa autopilot en la zona afectada */
  pausa_autopilot: z.literal(true).describe("Confirma que se pausó el modo autopilot"),
  fecha_servicio: z.string().min(1).describe("Fecha del servicio afectado (YYYY-MM-DD)"),
});

/** Emitido por weather-dispatch-gate.ts cuando lluvia agrega buffer a T_bloqueo. */
export const climaLluviaBufferPayloadSchema = z.object({
  zona: z.string().min(1).describe("Zona del área de servicio afectada"),
  /** Minutos adicionales agregados a T_bloqueo (siempre 15 según spec). */
  buffer_minutos: z.literal(15).describe("Minutos agregados al buffer de T_bloqueo por lluvia"),
  ordenes_afectadas: z
    .array(z.string().min(1))
    .min(1)
    .describe("Lista de order_id afectadas por el buffer adicional"),
  fecha_servicio: z.string().min(1).describe("Fecha del servicio afectado (YYYY-MM-DD)"),
});

/** Emitido por competitive-pricing.ts: snapshot de posición de precio vs competidores. */
export const pricingPosicionMercadoPayloadSchema = z.object({
  zona: z.string().min(1).describe("Zona del benchmark"),
  nuestro_precio_centavos: z.number().positive().describe("Nuestro precio promedio en centavos para la zona"),
  precio_promedio_competidores_centavos: z
    .number()
    .positive()
    .describe("Precio promedio de competidores en la zona (centavos)"),
  porcentaje_sobre_mercado: z.number().describe("Fracción firmada: positivo = estamos arriba, negativo = abajo"),
  competidores_considerados: z
    .array(
      z.object({
        competitor_id: z.string().min(1),
        competitor_name: z.string().min(1),
        price_cents: z.number().positive(),
      })
    )
    .min(1, "Debe haber al menos un competidor"),
  /** "above" | "below" | "at_par" con tolerancia de ±3% para "at_par". */
  posicion: z.enum(["above", "below", "at_par"]),
  timestamp: isoTimestampSchema.describe("Momento en que se calculó la posición"),
});

/** Emitido por inventory-dispatch-gate.ts: PO urgente generada automáticamente. */
export const inventarioPoUrgentePayloadSchema = z.object({
  item_id: z.string().min(1),
  item_name: z.string().min(1),
  deficit: z.number().positive(),
  motivo: z.string().min(1).describe("Razón de la PO urgente (ej. stock insuficiente para despacho)"),
  /** true → la PO se generó automáticamente, pendiente de aprobación humana. */
  generada_automaticamente: z.literal(true),
});

/** Emitido cuando se asigna equipo a un despacho (contexto compartido por varios módulos). */
export const despachoEquipoAsignadoPayloadSchema = z.object({
  order_id: z.string().min(1),
  team_id: z.string().min(1),
  leader_id: z.string().min(1),
  /** Lista de items de inventario asignados al servicio. */
  items_asignados: z.array(
    z.object({
      item_id: z.string().min(1),
      cantidad: z.number().positive(),
      unit: z.string().min(1),
    })
  ),
});

// ── Envelope canónico ───────────────────────────────────────────────────────

/** Tipo de evento discriminado — todos los eventos que el sistema emite. */
export const eventTypeSchema = z.enum([
  "empleado.horas_registradas",
  "inventario.stock_insuficiente",
  "inventario.po_urgente",
  "campaña.bloqueada",
  "campaña.activada",
  "clima.alerta_severa",
  "clima.lluvia_buffer",
  "pricing.posicion_mercado",
  "despacho.equipo_asignado",
]);

export type SystemEventType = z.infer<typeof eventTypeSchema>;

/**
 * Payload del evento validado según el tipo discriminado.
 * Cada event_type mapea exactamente a un schema de payload —
 * no hay payloads "genéricos" ni parcialmente validados.
 */
export const eventPayloadSchema = z.discriminatedUnion("event_type", [
  z.object({ event_type: z.literal("empleado.horas_registradas"), payload: empleadoHorasRegistradasPayloadSchema }),
  z.object({ event_type: z.literal("inventario.stock_insuficiente"), payload: inventarioStockInsuficientePayloadSchema }),
  z.object({ event_type: z.literal("inventario.po_urgente"), payload: inventarioPoUrgentePayloadSchema }),
  z.object({ event_type: z.literal("campaña.bloqueada"), payload: campaaBloqueadaPayloadSchema }),
  z.object({ event_type: z.literal("campaña.activada"), payload: campaaActivadaPayloadSchema }),
  z.object({ event_type: z.literal("clima.alerta_severa"), payload: climaAlertaSeveraPayloadSchema }),
  z.object({ event_type: z.literal("clima.lluvia_buffer"), payload: climaLluviaBufferPayloadSchema }),
  z.object({ event_type: z.literal("pricing.posicion_mercado"), payload: pricingPosicionMercadoPayloadSchema }),
  z.object({ event_type: z.literal("despacho.equipo_asignado"), payload: despachoEquipoAsignadoPayloadSchema }),
]);

/**
 * Envelope completo de cualquier evento del sistema.
 * Validación fuerte: el payload se valida contra el schema
 * específico del event_type discriminado.
 */
export const systemEventSchema = z.object({
  event_id: uuidv4Schema,
  aggregate_id: z.string().min(1, "aggregate_id no puede estar vacío").describe("ID de la entidad raíz del evento (orden, campaña, zona, etc.)"),
  timestamp: isoTimestampSchema,
  correlation_id: correlationIdSchema,
}).and(eventPayloadSchema);

export type SystemEvent = z.infer<typeof systemEventSchema>;

// ── Tipos auxiliares exportados ─────────────────────────────────────────────

/** Tipo extraído del payload de empleado.horas_registradas. */
export type EmpleadoHorasRegistradasPayload = z.infer<typeof empleadoHorasRegistradasPayloadSchema>;

/** Tipo extraído del payload de inventario.stock_insuficiente. */
export type InventarioStockInsuficientePayload = z.infer<typeof inventarioStockInsuficientePayloadSchema>;

/** Tipo extraído del payload de inventario.po_urgente. */
export type InventarioPoUrgentePayload = z.infer<typeof inventarioPoUrgentePayloadSchema>;

/** Tipo extraído del payload de campaña.bloqueada. */
export type CampaaBloqueadaPayload = z.infer<typeof campaaBloqueadaPayloadSchema>;

/** Tipo extraído del payload de campaña.activada. */
export type CampaaActivadaPayload = z.infer<typeof campaaActivadaPayloadSchema>;

/** Tipo extraído del payload de clima.alerta_severa. */
export type ClimaAlertaSeveraPayload = z.infer<typeof climaAlertaSeveraPayloadSchema>;

/** Tipo extraído del payload de clima.lluvia_buffer. */
export type ClimaLluviaBufferPayload = z.infer<typeof climaLluviaBufferPayloadSchema>;

/** Tipo extraído del payload de pricing.posicion_mercado. */
export type PricingPosicionMercadoPayload = z.infer<typeof pricingPosicionMercadoPayloadSchema>;

/** Tipo extraído del payload de despacho.equipo_asignado. */
export type DespachoEquipoAsignadoPayload = z.infer<typeof despachoEquipoAsignadoPayloadSchema>;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Construye un SystemEvent válido. Lanza ZodError si los datos no pasan
 * la validación estricta.
 *
 * @param event_type — tipo discriminado del evento
 * @param aggregate_id — ID de la entidad raíz (orden, campaña, zona, etc.)
 * @param correlation_id — ID que agrupa eventos del mismo flujo de negocio
 * @param payload — carga específica del evento (validada contra el schema del tipo)
 * @returns SystemEvent con event_id UUIDv4 generado y timestamp actual en ISO8601
 */
export function buildSystemEvent<K extends SystemEventType>(
  event_type: K,
  aggregate_id: string,
  correlation_id: string,
  payload: Extract<SystemEvent, { event_type: K }>["payload"],
): SystemEvent {
  const event: unknown = {
    event_id: crypto.randomUUID(),
    aggregate_id,
    timestamp: new Date().toISOString(),
    correlation_id,
    event_type,
    payload,
  };
  return systemEventSchema.parse(event);
}

/**
 * Valida un supuesto SystemEvent sin construirlo. Útil para verificar
 * eventos recibidos desde una cola o almacén externo.
 *
 * @returns el evento validado, o lanza ZodError si no cumple el schema.
 */
export function validateSystemEvent(candidate: unknown): SystemEvent {
  return systemEventSchema.parse(candidate);
}

/**
 * v8.3 E.1.1 — Live Service Tracking (Centro de Transparencia).
 *
 * Portal en vivo donde el cliente ve el progreso de su servicio: ETA estimada,
 * zonas completadas ("Cocina ✓, Baño en curso…"), productos usados durante la
 * limpieza, y estado general del servicio. Diseñado para consumo vía polling
 * cada 60 segundos desde la ruta /account/services/[orderId].
 *
 * INVARIANTE DURO (E.1.1 spec): este módulo es estructuralmente incapaz de
 * exponer la ubicación GPS del empleado. Solo muestra hitos de zona — el
 * cliente sabe QUÉ se completó, no DÓNDE está el empleado en ese momento.
 * No existe ningún campo `lat`, `lng`, `gps`, `location`, `position`, ni
 * coordenada de ningún tipo en las interfaces de este módulo.
 *
 * Consume: zone-assignment.ts (para confirmar qué zonas pertenecen a esta orden).
 *
 * El polling real (setInterval / React Query) y la orquestación Supabase
 * viven en el componente de cuenta del cliente — este módulo solo expone
 * lógica pura de transformación y validación.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

/** Intervalo de polling recomendado en segundos (spec: 60s). */
export const LIVE_TRACKING_POLL_INTERVAL_SEC = 60;

/** Máximo de productos usados que se muestran al cliente (evita abrumar). */
export const MAX_VISIBLE_PRODUCTS = 8;

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS — validación de entrada desde el route handler
// ═══════════════════════════════════════════════════════════════════════════

export const ZoneProgressSchema = z.object({
  zone: z.string().min(1).describe("Código de zona (bathroom, kitchen, living_room, etc.)"),
  zoneLabel: z.string().min(1).describe("Etiqueta legible para el cliente (Baño, Cocina, Sala)"),
  totalItems: z.number().int().min(0),
  completedItems: z.number().int().min(0),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const ProductUsedSchema = z.object({
  productName: z.string().min(1).describe("Nombre comercial del producto"),
  zoneUsedIn: z.string().min(1).describe("Zona donde se aplicó"),
  /** Ícono o emoji sugerido para UI (nunca código químico interno). */
  icon: z.string().optional(),
});

export const LiveTrackingSnapshotSchema = z.object({
  orderId: z.string().uuid(),
  serviceStatus: z.enum(["en_route", "in_progress", "finalizando", "completed"]),
  etaMinutes: z.number().int().min(0).nullable().describe("Minutos estimados para completar, null si completed"),
  zones: z.array(ZoneProgressSchema),
  productsUsed: z.array(ProductUsedSchema).max(MAX_VISIBLE_PRODUCTS),
  startedAtISO: z.string().nullable(),
  estimatedCompletionISO: z.string().nullable(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DERIVADOS
// ═══════════════════════════════════════════════════════════════════════════

export type ZoneProgress = z.infer<typeof ZoneProgressSchema>;
export type ProductUsed = z.infer<typeof ProductUsedSchema>;
export type LiveTrackingSnapshot = z.infer<typeof LiveTrackingSnapshotSchema>;

export type ServiceStatus = LiveTrackingSnapshot["serviceStatus"];

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PURAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el porcentaje de progreso global del servicio (0-100) a partir
 * del estado de las zonas. Pondera equitativamente todas las zonas.
 */
export function computeOverallProgress(zones: ZoneProgress[]): number {
  if (zones.length === 0) return 0;
  const totalItems = zones.reduce((sum, z) => sum + z.totalItems, 0);
  const completedItems = zones.reduce((sum, z) => sum + z.completedItems, 0);
  if (totalItems === 0) return 0;
  return Math.round((completedItems / totalItems) * 100);
}

/**
 * Cuenta cuántas zonas están en cada estado. Útil para el resumen visual
 * "3 completadas, 1 en curso, 2 pendientes".
 */
export function countZonesByStatus(zones: ZoneProgress[]): {
  pending: number;
  inProgress: number;
  completed: number;
} {
  return {
    pending: zones.filter((z) => z.status === "pending").length,
    inProgress: zones.filter((z) => z.status === "in_progress").length,
    completed: zones.filter((z) => z.status === "completed").length,
  };
}

/**
 * Ordena las zonas para presentación al cliente:
 * 1. En curso primero (lo que está pasando ahora).
 * 2. Completadas después (logro visible).
 * 3. Pendientes al final (lo que falta).
 *
 * Dentro de cada grupo, orden alfabético por etiqueta.
 */
export function sortZonesForDisplay(zones: ZoneProgress[]): ZoneProgress[] {
  const order: Record<ZoneProgress["status"], number> = {
    in_progress: 0,
    completed: 1,
    pending: 2,
  };
  return [...zones].sort(
    (a, b) => order[a.status] - order[b.status] || a.zoneLabel.localeCompare(b.zoneLabel)
  );
}

/**
 * Genera un mensaje de estado legible para el cliente en español.
 * Ejemplos:
 *   - "Tu equipo está en camino — llegada estimada en ~15 min"
 *   - "Limpiando: Baño en curso, Cocina ✓, Sala pendiente"
 *   - "¡Servicio completado! Revisa tu Home Health Report."
 */
export function buildStatusMessage(snapshot: LiveTrackingSnapshot): string {
  switch (snapshot.serviceStatus) {
    case "en_route": {
      const eta = snapshot.etaMinutes != null ? `~${snapshot.etaMinutes} min` : "pronto";
      return `Tu equipo está en camino — llegada estimada en ${eta}.`;
    }
    case "in_progress": {
      const sorted = sortZonesForDisplay(snapshot.zones);
      const parts = sorted.map((z) => {
        const icon = z.status === "completed" ? "✓" : z.status === "in_progress" ? "en curso" : "";
        return icon ? `${z.zoneLabel} ${icon}` : z.zoneLabel;
      });
      return `Limpiando: ${parts.join(", ")}.`;
    }
    case "finalizando":
      return "Tu equipo está finalizando los últimos detalles.";
    case "completed":
      return "¡Servicio completado! Revisa tu Home Health Report.";
  }
}

/**
 * Agrupa los productos usados por zona para mostrarlos de forma organizada
 * ("En la Cocina usamos: Producto A, Producto B. En el Baño: Producto C.").
 */
export function groupProductsByZone(products: ProductUsed[]): Map<string, ProductUsed[]> {
  const grouped = new Map<string, ProductUsed[]>();
  for (const p of products) {
    const list = grouped.get(p.zoneUsedIn) || [];
    list.push(p);
    grouped.set(p.zoneUsedIn, list);
  }
  return grouped;
}

/**
 * Valida que un snapshot recibido desde la API cumpla con el schema Zod
 * y con las reglas de negocio adicionales. El route handler debe llamar esto
 * antes de devolver datos al cliente.
 *
 * Retorna el snapshot parseado o un error descriptivo.
 */
export function validateAndParseTrackingSnapshot(
  raw: unknown
): { valid: true; data: LiveTrackingSnapshot } | { valid: false; error: string } {
  const result = LiveTrackingSnapshotSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }

  const data = result.data;

  // Regla de negocio: no puede haber más completedItems que totalItems en ninguna zona.
  for (const zone of data.zones) {
    if (zone.completedItems > zone.totalItems) {
      return {
        valid: false,
        error: `Zona "${zone.zoneLabel}": completedItems (${zone.completedItems}) > totalItems (${zone.totalItems})`,
      };
    }
  }

  // Regla de negocio: si el servicio está "completed", TODAS las zonas deben estar completadas.
  if (data.serviceStatus === "completed") {
    const incomplete = data.zones.filter((z) => z.status !== "completed");
    if (incomplete.length > 0) {
      return {
        valid: false,
        error: `Servicio marcado como "completed" pero hay ${incomplete.length} zonas sin completar: ${incomplete.map((z) => z.zoneLabel).join(", ")}`,
      };
    }
  }

  // Regla de negocio: si está "en_route", no debería haber zonas en progreso.
  if (data.serviceStatus === "en_route") {
    const active = data.zones.filter((z) => z.status !== "pending");
    if (active.length > 0) {
      return {
        valid: false,
        error: `Servicio "en_route" no debería tener zonas activas: ${active.map((z) => z.zoneLabel).join(", ")}`,
      };
    }
  }

  return { valid: true, data };
}

/**
 * Determina si el snapshot indica que el servicio está activo (el cliente
 * debe seguir viendo el portal en vivo). False solo cuando está "completed".
 */
export function isServiceActive(snapshot: LiveTrackingSnapshot): boolean {
  return snapshot.serviceStatus !== "completed";
}

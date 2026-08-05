/**
 * v8.3 D.9 — Legal → Operations Bridge.
 *
 * Puente entre el monitoreo legal (legal-monitoring.ts, E9.7) y los módulos
 * operativos que deben reaccionar ante cambios regulatorios.
 *
 * Flujo:
 *   legal-monitoring.ts emite `event.legal.cambio_regulatorio` con un ámbito
 *   (químicos, laboral, seguro). Este módulo clasifica el ámbito y determina
 *   qué suscriptores operativos deben ser notificados:
 *
 *   - Ámbito "quimicos" → chemical-lockout.ts: bloquear/ajustar productos
 *     afectados hasta revisión.
 *   - Ámbito "laboral"  → cumplimiento-laboral (shift-rest.ts, sick-leave.ts,
 *     workplace-incident.ts): revisar ratios, descansos, protocolos.
 *   - Ámbito "seguro"   → business-insurance.ts, vehicle-insurance.ts:
 *     verificar coberturas vigentes.
 *
 * Diseño: funciones puras de enrutamiento + Zod schemas para los payloads
 * del event_log. Los suscriptores reales (módulos) se conectan a través de
 * la tabla event_log — este archivo no llama a los módulos directamente,
 * clasifica y devuelve la lista de suscriptores que DEBEN ser notificados.
 *
 * Interconexiones:
 *   legal-monitoring.ts ──(event.legal.cambio_regulatorio)──→ legal-ops-bridge.ts
 *       ├── chemical-lockout.ts (ámbito: quimicos)
 *       ├── shift-rest.ts / sick-leave.ts (ámbito: laboral)
 *       └── business-insurance.ts (ámbito: seguro)
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ámbitos regulatorios que este módulo puede enrutar. */
export const REGULATORY_SCOPES = ["quimicos", "laboral", "seguro"] as const;

export type RegulatoryScope = (typeof REGULATORY_SCOPES)[number];

/** Módulos operativos suscriptores, mapeados por ámbito. */
export const SCOPE_SUBSCRIBERS: Record<RegulatoryScope, string[]> = {
  quimicos: ["chemical-lockout"],
  laboral: ["shift-rest", "sick-leave", "workplace-incident", "payroll-deductions"],
  seguro: ["business-insurance", "vehicle-insurance"],
};

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** Severidad del cambio regulatorio. */
export type RegulatorySeverity =
  | "info"        // Actualización informativa, sin acción inmediata.
  | "review"      // Requiere revisión en los próximos 7 días.
  | "urgent";     // Acción requerida en 24-48h — puede implicar bloqueo operativo.

/** Fuente de la regulación. */
export type RegulatorySource =
  | "worksafe_bc"
  | "environment_canada"
  | "health_canada"
  | "bc_ministry_of_labour"
  | "cra"
  | "municipal"
  | "other";

export interface RegulatoryChangeInput {
  /** Ámbito(s) afectados. Un cambio puede tocar múltiples ámbitos (ej. nueva ley de químicos + seguro). */
  scopes: RegulatoryScope[];
  severity: RegulatorySeverity;
  source: RegulatorySource;
  /** Título corto de la regulación o cambio. */
  title: string;
  /** Descripción del cambio y su impacto operativo potencial. */
  description: string;
  /** Fecha de entrada en vigor (YYYY-MM-DD). */
  effectiveDate: string;
  /** URL o referencia al texto oficial. */
  referenceUrl?: string;
  /** Productos específicos afectados (solo para ámbito "quimicos"). */
  affectedProducts?: string[];
  /** Fecha en que se detectó el cambio (YYYY-MM-DD). */
  detectedAt: string;
}

export interface RoutedRegulatoryNotification {
  scope: RegulatoryScope;
  subscribers: string[];
  payload: RegulatoryChangePayload;
}

// ---------------------------------------------------------------------------
// Event payload (Zod-validated for event_log)
// ---------------------------------------------------------------------------

export const RegulatoryChangePayloadSchema = z.object({
  event: z.literal("event.legal.cambio_regulatorio"),
  scopes: z.array(z.enum(["quimicos", "laboral", "seguro"])).min(1),
  severity: z.enum(["info", "review", "urgent"]),
  source: z.enum([
    "worksafe_bc",
    "environment_canada",
    "health_canada",
    "bc_ministry_of_labour",
    "cra",
    "municipal",
    "other",
  ]),
  title: z.string().min(1),
  description: z.string().min(1),
  effective_date: z.string(),
  reference_url: z.string().optional(),
  affected_products: z.array(z.string().min(1)).optional(),
  detected_at: z.string(),
  /** Módulos que deben ser notificados. */
  subscribers: z.array(z.string().min(1)),
  /** Si es "urgent" y afecta productos, el bloqueo debe ser inmediato. */
  requires_immediate_lockout: z.boolean(),
});

export type RegulatoryChangePayload = z.infer<
  typeof RegulatoryChangePayloadSchema
>;

// ---------------------------------------------------------------------------
// Classification logic
// ---------------------------------------------------------------------------

/**
 * Dado un cambio regulatorio, determina:
 *   1. Si el cambio es accionable (severity >= "review").
 *   2. Si requiere bloqueo inmediato (severity === "urgent" Y afecta productos).
 *
 * Cambios meramente informativos (severity === "info") no bloquean nada
 * pero igual se registran en event_log para trazabilidad.
 */
export function classifyRegulatoryUrgency(
  input: RegulatoryChangeInput
): {
  isActionable: boolean;
  requiresImmediateLockout: boolean;
} {
  const isActionable = input.severity !== "info";
  const requiresImmediateLockout =
    input.severity === "urgent" &&
    input.scopes.includes("quimicos") &&
    (input.affectedProducts?.length ?? 0) > 0;

  return { isActionable, requiresImmediateLockout };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Enruta un cambio regulatorio a los suscriptores operativos correctos
 * según el ámbito. Un cambio puede generar múltiples notificaciones (una
 * por ámbito).
 *
 * Solo los ámbitos con suscriptores definidos generan notificación.
 * Ámbitos sin suscriptores (si se añadieran en el futuro) se ignoran
 * silenciosamente — el cambio igual se registra en event_log pero sin
 * acciones operativas automáticas.
 *
 * @returns Lista de notificaciones enrutadas, una por ámbito con suscriptores.
 */
export function routeRegulatoryChange(
  input: RegulatoryChangeInput
): RoutedRegulatoryNotification[] {
  const { requiresImmediateLockout } =
    classifyRegulatoryUrgency(input);

  const notifications: RoutedRegulatoryNotification[] = [];

  for (const scope of input.scopes) {
    const subscribers = SCOPE_SUBSCRIBERS[scope];
    if (!subscribers || subscribers.length === 0) continue;

    // Si no es accionable y no es "quimicos" urgente, igual registramos
    // pero marcamos requires_immediate_lockout = false.
    const payload: RegulatoryChangePayload = {
      event: "event.legal.cambio_regulatorio",
      scopes: input.scopes,
      severity: input.severity,
      source: input.source,
      title: input.title,
      description: input.description,
      effective_date: input.effectiveDate,
      reference_url: input.referenceUrl,
      affected_products:
        scope === "quimicos" ? input.affectedProducts : undefined,
      detected_at: input.detectedAt,
      subscribers,
      requires_immediate_lockout:
        scope === "quimicos" ? requiresImmediateLockout : false,
    };

    // Validar contra el schema Zod
    notifications.push({
      scope,
      subscribers,
      payload: RegulatoryChangePayloadSchema.parse(payload),
    });
  }

  return notifications;
}

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

/**
 * Determina si un módulo específico debe ser notificado dado un cambio
 * regulatorio ya clasificado. Útil para que el consumer del event_log
 * (polling cada 5s) decida si despertar a un módulo.
 *
 * @param subscriberModule Nombre del módulo (ej. "chemical-lockout").
 * @param change           El cambio regulatorio ya enrutado.
 * @returns true si el módulo está en la lista de suscriptores.
 */
export function isSubscriberAffected(
  subscriberModule: string,
  change: RegulatoryChangePayload
): boolean {
  return change.subscribers.includes(subscriberModule);
}

/**
 * Filtra los cambios regulatorios que afectan a un módulo específico de
 * una lista de cambios registrados. Caso de uso: el consumer del event_log
 * filtra eventos nuevos y solo despierta a los módulos relevantes.
 */
export function filterChangesForSubscriber(
  subscriberModule: string,
  changes: RegulatoryChangePayload[]
): RegulatoryChangePayload[] {
  return changes.filter((c) => isSubscriberAffected(subscriberModule, c));
}

// ---------------------------------------------------------------------------
// Chemical-specific helpers
// ---------------------------------------------------------------------------

/**
 * Determina si un cambio regulatorio afecta productos químicos específicos
 * que están en el código cromático activo (chemical-lockout.ts).
 *
 * @param change           Cambio regulatorio ya enrutado.
 * @param activeProducts   Lista de productos actualmente en uso (ej. del CHEMICAL_CODES).
 * @returns Lista de productos afectados que coinciden con los activos.
 */
export function findAffectedActiveProducts(
  change: RegulatoryChangePayload,
  activeProducts: string[]
): string[] {
  if (!change.affected_products || change.affected_products.length === 0) {
    return [];
  }
  const activeSet = new Set(activeProducts.map((p) => p.toLowerCase()));
  return change.affected_products.filter((p) =>
    activeSet.has(p.toLowerCase())
  );
}

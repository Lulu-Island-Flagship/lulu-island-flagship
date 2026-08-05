/**
 * v8.3 E.1.3 — Home Health Report (Reporte de Salud del Hogar).
 *
 * Transforma los datos crudos de limpieza en insights accionables para el
 * cliente: galería antes/después, checklist completado, Nota de Cuidado del
 * equipo (máx. 140 caracteres, validada contra lista negra NLP), recomendaciones
 * de mantenimiento personalizadas, y "Costo Acumulado Evitado" para clientes
 * recurrentes (cuánto han ahorrado al mantener vs. reparar/limpieza profunda).
 *
 * INVARIANTES DUROS:
 *   - NUNCA expone HHE (horas hombre estimadas) al cliente.
 *   - NUNCA expone N (número de operarios) al cliente.
 *   - NUNCA expone el score interno del cliente.
 *   - NUNCA expone nombres individuales de empleados — la Nota de Cuidado se
 *     firma como "Equipo [Nombre]" y se filtra contra identificadores personales.
 *
 * Consume:
 *   - live-portfolio.ts: buildAnonymousLabel (etiquetado anónimo de zonas)
 *   - closure-protocol.ts: ZoneClosureStatus, evaluateClosureProtocol (checklist)
 *
 * Lógica pura: sin I/O. El route handler junta los datos de Supabase
 * (checklist, fotos, metadata del cliente) y los pasa a estas funciones.
 */

import { z } from "zod";
import type { ZoneClosureStatus } from "./closure-protocol";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

/** Longitud máxima de la Nota de Cuidado (spec: 140 chars). */
export const CARE_NOTE_MAX_LENGTH = 140;

/** Costo estimado de una limpieza profunda correctiva (referencia para "Costo Evitado"). */
export const DEEP_CLEAN_COST_REFERENCE_CAD = 450;

/** Costo estimado de reparación menor por falta de mantenimiento. */
export const MINOR_REPAIR_COST_REFERENCE_CAD = 150;

/** Frecuencia recomendada de servicio recurrente en días. */
export const RECOMMENDED_RECURRING_INTERVAL_DAYS = 21;

/** Máximo de recomendaciones de mantenimiento a generar por reporte. */
export const MAX_MAINTENANCE_RECOMMENDATIONS = 5;

// ═══════════════════════════════════════════════════════════════════════════
// LISTA NEGRA NLP — validación de la Nota de Cuidado
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patrones prohibidos en la Nota de Cuidado. La nota es del equipo para el
 * cliente — debe ser profesional, respetuosa, y no contener:
 *   - Información personal identificable (nombres, teléfonos, emails)
 *   - Lenguaje ofensivo, agresivo o inapropiado
 *   - Información interna (HHE, scores, precios, datos de otros clientes)
 *   - Solicitudes externas (WhatsApp personal, propinas, pagos fuera del sistema)
 *
 * Cada entrada es [patrón_regex, razón_del_bloqueo].
 */
const CARE_NOTE_BLACKLIST: [RegExp, string][] = [
  // Información personal
  [/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/, "número de teléfono"],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, "dirección de email"],
  [/\b(whatsapp|telegram|signal|wechat)\b.*\b\d{5,}\b/i, "contacto externo con número"],
  [/\b(ll[aá]mame|escr[ií]beme|cont[aá]ctame)\b.*\b\d{2,}\b/i, "solicitud de contacto personal"],

  // Información interna (NUNCA visible al cliente)
  [/\b[Hh][Hh][Ee]\b/, "HHE (horas hombre estimadas)"],
  [/\b(score|puntaje|puntuaci[oó]n)\s*(interno|del\s*cliente|cliente)/i, "score interno del cliente"],
  [/\b(precio|costo|tarifa|fee|cobro|charge)\b.*\$\d+/i, "información de precios"],
  [/\bN\s*=\s*\d+\b/, "N (número de operarios)"],
  [/\b(operario|empleado|trabajador)\s*(#\d+|individual)/i, "identificador de empleado individual"],

  // Lenguaje inapropiado
  [/\b(puta|mierda|cul[aoe]|pendej|idiota|est[uú]pid|imb[eé]cil)\b/i, "lenguaje ofensivo"],
  [/\b(fuck|shit|damn|bastard|bitch|asshole)\b/i, "lenguaje ofensivo (EN)"],

  // Solicitudes inapropiadas
  [/\b(propina|tip)\s*(de|del)?\s*\$?\d+/i, "solicitud de propina con monto"],
  [/\b(p[aá]gu?eme|transfi[eé]rame|depos[ií]teme)\b/i, "solicitud de pago directo"],
  [/\b(mi\s*whatsapp|mi\s*celular|mi\s*tel[eé]fono|mi\s*cel)\b/i, "compartir contacto personal"],

  // Datos de otros clientes (posible fuga de PIPEDA)
  [/\b(el|la)\s*(cliente|señor|señora|sr|sra)\b.*\b(dijo|pidió|solicitó|quería)\b/i, "mencionar a otro cliente"],
];

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const HomeHealthReportSchema = z.object({
  /** Fecha del servicio. */
  serviceDate: z.string().min(1),
  /** Zonas con su estado de completitud y fotos. */
  zones: z.array(
    z.object({
      zone: z.string().min(1),
      zoneLabel: z.string().min(1),
      totalItems: z.number().int().min(0),
      completedItems: z.number().int().min(0),
      hasAfterPhoto: z.boolean(),
      afterPhotoUrls: z.array(z.string()).max(3),
    })
  ),
  /** Checklist global: ¿está todo completo? */
  checklistComplete: z.boolean(),
  /** Porcentaje del checklist completado (0-100). */
  checklistPercent: z.number().min(0).max(100),
  /** Nota de Cuidado del equipo (140 chars máx., ya validada). */
  careNote: z.string().max(CARE_NOTE_MAX_LENGTH).nullable(),
  /** ¿Quién firmó la nota? Solo "Equipo [Nombre]" — nunca nombre individual. */
  careNoteAuthor: z.string().min(1).max(50).nullable(),
  /** Recomendaciones de mantenimiento generadas. */
  recommendations: z.array(
    z.object({
      zone: z.string().min(1),
      zoneLabel: z.string().min(1),
      /** Recomendación legible (ej. "Revisar sellos de silicona en 2 semanas"). */
      text: z.string().min(1).max(200),
      /** Prioridad: alta (atender ya), media (próximo servicio), baja (informativo). */
      priority: z.enum(["high", "medium", "low"]),
      /** Tipo: maintenance (mantenimiento regular), repair (reparación sugerida), upgrade (mejora). */
      type: z.enum(["maintenance", "repair", "upgrade"]),
    })
  ).max(MAX_MAINTENANCE_RECOMMENDATIONS),
  /** Costo acumulado evitado (solo para clientes recurrentes, null si es primer servicio). */
  cumulativeCostAvoidedCAD: z.number().min(0).nullable(),
  /** ¿Es un cliente recurrente? (≥ 2 servicios). */
  isRecurring: z.boolean(),
  /** Próximo servicio sugerido (fecha ISO). */
  suggestedNextServiceISO: z.string().nullable(),
  /** ¿Se recomienda aumentar frecuencia? */
  frequencyUpgradeSuggested: z.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DERIVADOS
// ═══════════════════════════════════════════════════════════════════════════

export type HomeHealthReport = z.infer<typeof HomeHealthReportSchema>;
export type MaintenanceRecommendation = HomeHealthReport["recommendations"][number];
export type RecommendationPriority = MaintenanceRecommendation["priority"];
export type RecommendationType = MaintenanceRecommendation["type"];

export interface HomeHealthReportInput {
  serviceDate: string;
  zones: ZoneClosureStatus[];
  afterPhotoUrlsByZone: Map<string, string[]>;
  careNoteRaw: string | null;
  careNoteAuthorTeamName: string | null;
  isRecurring: boolean;
  totalServicesCompleted: number;
  lastServiceDateISO: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN NLP DE LA NOTA DE CUIDADO
// ═══════════════════════════════════════════════════════════════════════════

export interface CareNoteValidationResult {
  valid: boolean;
  sanitized: string | null;
  blockReasons: string[];
}

/**
 * Valida la Nota de Cuidado contra la lista negra NLP.
 * Si encuentra coincidencias, bloquea la nota completa (fail-closed:
 * mejor no mostrar nota que mostrar contenido inapropiado).
 *
 * El texto YA debe venir truncado a 140 chars por el caller (el empleado
 * no puede escribir más de 140 chars en el input).
 */
export function validateCareNote(raw: string | null): CareNoteValidationResult {
  if (!raw || raw.trim().length === 0) {
    return { valid: true, sanitized: null, blockReasons: [] };
  }

  const trimmed = raw.trim().slice(0, CARE_NOTE_MAX_LENGTH);
  const blockReasons: string[] = [];

  for (const [pattern, reason] of CARE_NOTE_BLACKLIST) {
    if (pattern.test(trimmed)) {
      blockReasons.push(reason);
    }
  }

  if (blockReasons.length > 0) {
    return { valid: false, sanitized: null, blockReasons };
  }

  return { valid: true, sanitized: trimmed, blockReasons: [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// RECOMENDACIONES DE MANTENIMIENTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Catálogo de recomendaciones de mantenimiento por zona. Cada zona tiene
 * reglas base que se activan según el estado (checklist completado, fotos
 * disponibles, zona crítica).
 *
 * Las recomendaciones son sugerencias GENERALES de mantenimiento del hogar,
 * nunca instrucciones operativas internas ni revelan datos del empleado.
 */
const MAINTENANCE_CATALOG: Record<string, MaintenanceRecommendation[]> = {
  bathroom: [
    {
      zone: "bathroom",
      zoneLabel: "Baño",
      text: "Revisar sellos de silicona en la ducha — si hay moho entre servicios, considerar tratamiento anti-hongos.",
      priority: "medium",
      type: "maintenance",
    },
    {
      zone: "bathroom",
      zoneLabel: "Baño",
      text: "El extractor de aire debe funcionar al menos 20 min post-ducha para prevenir humedad acumulada.",
      priority: "low",
      type: "maintenance",
    },
    {
      zone: "bathroom",
      zoneLabel: "Baño",
      text: "Aplicar sellador de lechada cada 6 meses protege contra filtraciones y reduce limpieza profunda.",
      priority: "medium",
      type: "upgrade",
    },
  ],
  kitchen: [
    {
      zone: "kitchen",
      zoneLabel: "Cocina",
      text: "Limpiar el filtro de la campana extractora cada 30 días — la grasa acumulada reduce eficiencia y es riesgo de incendio.",
      priority: "high",
      type: "maintenance",
    },
    {
      zone: "kitchen",
      zoneLabel: "Cocina",
      text: "Revisar sellos del refrigerador — un sello dañado aumenta el consumo eléctrico hasta 15%.",
      priority: "low",
      type: "repair",
    },
    {
      zone: "kitchen",
      zoneLabel: "Cocina",
      text: "Bicarbonato + vinagre mensual en el desagüe previene obstrucciones sin químicos agresivos.",
      priority: "low",
      type: "maintenance",
    },
  ],
  living_room: [
    {
      zone: "living_room",
      zoneLabel: "Sala",
      text: "Rotar los muebles cada 3 meses distribuye el desgaste de la alfombra/piso y la exposición al sol.",
      priority: "low",
      type: "maintenance",
    },
    {
      zone: "living_room",
      zoneLabel: "Sala",
      text: "Aspirar debajo de los muebles grandes al menos cada 2 servicios — la acumulación atrae ácaros.",
      priority: "medium",
      type: "maintenance",
    },
  ],
  bedroom: [
    {
      zone: "bedroom",
      zoneLabel: "Dormitorio",
      text: "Lavar fundas de almohada y sábanas cada 7 días reduce ácaros y mejora calidad del sueño.",
      priority: "medium",
      type: "maintenance",
    },
    {
      zone: "bedroom",
      zoneLabel: "Dormitorio",
      text: "Aspirar el colchón cada 3 meses elimina alérgenos acumulados que no se ven a simple vista.",
      priority: "low",
      type: "maintenance",
    },
  ],
};

/**
 * Genera recomendaciones de mantenimiento personalizadas basadas en las
 * zonas del servicio. Solo incluye zonas que efectivamente se limpiaron
 * y que están en el catálogo.
 *
 * Prioriza: high primero, luego medium, luego low. Máximo 5.
 */
export function generateMaintenanceRecommendations(
  zones: ZoneClosureStatus[]
): MaintenanceRecommendation[] {
  const recs: MaintenanceRecommendation[] = [];

  for (const zone of zones) {
    const catalog = MAINTENANCE_CATALOG[zone.zone];
    if (!catalog) continue;

    // Solo generar recomendaciones para zonas con checklist > 0 (zonas reales)
    if (zone.totalItems === 0) continue;

    // Incluir todas las recomendaciones del catálogo para esta zona
    for (const rec of catalog) {
      recs.push({ ...rec });
    }
  }

  // Ordenar: high → medium → low
  const priorityOrder: Record<RecommendationPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recs.slice(0, MAX_MAINTENANCE_RECOMMENDATIONS);
}

// ═══════════════════════════════════════════════════════════════════════════
// COSTO ACUMULADO EVITADO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el "Costo Acumulado Evitado" para clientes recurrentes.
 *
 * Lógica: cada servicio recurrente de mantenimiento previene aproximadamente
 * 1 limpieza profunda correctiva cada 4 servicios (estimación conservadora) y
 * 1 reparación menor cada 6 servicios. El costo evitado es acumulativo.
 *
 * Solo aplica a clientes con ≥ 2 servicios completados.
 *
 * @param totalServicesCompleted Total de servicios completados (histórico).
 * @param isRecurring ¿Es cliente recurrente? (≥ 2 servicios).
 * @returns Costo evitado acumulado en CAD, o null si no aplica (primer servicio).
 */
export function calculateCumulativeCostAvoided(
  totalServicesCompleted: number,
  isRecurring: boolean
): number | null {
  if (!isRecurring || totalServicesCompleted < 2) return null;

  // Cada 4 servicios de mantenimiento = 1 deep clean evitada
  const deepCleansAvoided = Math.floor(totalServicesCompleted / 4);
  // Cada 6 servicios = 1 reparación menor evitada
  const repairsAvoided = Math.floor(totalServicesCompleted / 6);

  const totalAvoided =
    deepCleansAvoided * DEEP_CLEAN_COST_REFERENCE_CAD +
    repairsAvoided * MINOR_REPAIR_COST_REFERENCE_CAD;

  return totalAvoided;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DEL REPORTE COMPLETO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye el Home Health Report completo a partir de los datos del
 * servicio. Esta es la función principal que el route handler llama.
 *
 * Flujo:
 *   1. Validar la Nota de Cuidado contra la lista negra NLP.
 *   2. Calcular el porcentaje del checklist.
 *   3. Generar recomendaciones de mantenimiento.
 *   4. Calcular costo acumulado evitado (si aplica).
 *   5. Sugerir próxima fecha de servicio (si recurrente).
 *   6. Armar el objeto final con Zod validation.
 */
export function buildHomeHealthReport(input: HomeHealthReportInput): {
  valid: true;
  report: HomeHealthReport;
} | {
  valid: false;
  error: string;
} {
  // 1. Validar Nota de Cuidado
  const careNoteValidation = validateCareNote(input.careNoteRaw);
  if (!careNoteValidation.valid && input.careNoteRaw) {
    // Nota bloqueada por NLP — no es error fatal, simplemente no se muestra.
    // El admin recibe una alerta interna (no implementada aquí, es responsabilidad
    // del route handler loggearlo).
  }

  // 2. Calcular checklist
  const totalItems = input.zones.reduce((s, z) => s + z.totalItems, 0);
  const completedItems = input.zones.reduce((s, z) => s + z.completedItems, 0);
  const checklistPercent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const checklistComplete = checklistPercent === 100;

  // 3. Generar recomendaciones
  const recommendations = generateMaintenanceRecommendations(input.zones);

  // 4. Costo acumulado evitado
  const cumulativeCostAvoidedCAD = calculateCumulativeCostAvoided(
    input.totalServicesCompleted,
    input.isRecurring
  );

  // 5. Sugerir próxima fecha
  let suggestedNextServiceISO: string | null = null;
  let frequencyUpgradeSuggested = false;

  if (input.isRecurring && input.lastServiceDateISO) {
    const lastDate = new Date(input.lastServiceDateISO);
    const suggested = new Date(lastDate);
    suggested.setUTCDate(suggested.getUTCDate() + RECOMMENDED_RECURRING_INTERVAL_DAYS);
    suggestedNextServiceISO = suggested.toISOString().slice(0, 10);

    // Sugerir aumento de frecuencia si han pasado > 30 días desde el último servicio
    if (input.lastServiceDateISO) {
      const daysSinceLast = Math.round(
        (new Date(input.serviceDate).getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      frequencyUpgradeSuggested = daysSinceLast > 30;
    }
  }

  // 6. Armar zonas con URLs de fotos
  const zonesWithPhotos = input.zones.map((z) => ({
    zone: z.zone,
    zoneLabel: z.zoneLabel,
    totalItems: z.totalItems,
    completedItems: z.completedItems,
    hasAfterPhoto: z.hasAfterPhoto,
    afterPhotoUrls: input.afterPhotoUrlsByZone.get(z.zone) ?? [],
  }));

  // 7. Validar con Zod
  const report = HomeHealthReportSchema.safeParse({
    serviceDate: input.serviceDate,
    zones: zonesWithPhotos,
    checklistComplete,
    checklistPercent,
    careNote: careNoteValidation.sanitized,
    careNoteAuthor: input.careNoteAuthorTeamName,
    recommendations,
    cumulativeCostAvoidedCAD,
    isRecurring: input.isRecurring,
    suggestedNextServiceISO,
    frequencyUpgradeSuggested,
  });

  if (!report.success) {
    return {
      valid: false,
      error: report.error.issues.map((i) => i.message).join("; "),
    };
  }

  return { valid: true, report: report.data };
}

/**
 * Genera un resumen ejecutivo en texto para el email/post-servicio.
 * Ejemplo: "Checklist 100% completo (18/18 ítems). Nota de Cuidado del
 * Equipo Jade. 2 recomendaciones de mantenimiento. Costo evitado: $150 CAD."
 */
export function buildReportSummaryText(report: HomeHealthReport): string {
  const parts: string[] = [];

  // Checklist
  const totalItems = report.zones.reduce((s, z) => s + z.totalItems, 0);
  const completedItems = report.zones.reduce((s, z) => s + z.completedItems, 0);
  const icon = report.checklistComplete ? "✓" : "⚠";
  parts.push(`Checklist ${icon} ${report.checklistPercent}% (${completedItems}/${totalItems} ítems)`);

  // Nota de Cuidado
  if (report.careNote && report.careNoteAuthor) {
    parts.push(`Nota de ${report.careNoteAuthor}: "${report.careNote}"`);
  }

  // Recomendaciones
  if (report.recommendations.length > 0) {
    const highCount = report.recommendations.filter((r) => r.priority === "high").length;
    const parts2: string[] = [`${report.recommendations.length} recomendaciones`];
    if (highCount > 0) parts2.push(`${highCount} prioritarias`);
    parts.push(parts2.join(", "));
  }

  // Costo evitado
  if (report.cumulativeCostAvoidedCAD !== null && report.cumulativeCostAvoidedCAD > 0) {
    parts.push(`Costo evitado acumulado: $${report.cumulativeCostAvoidedCAD} CAD`);
  }

  // Próximo servicio
  if (report.suggestedNextServiceISO) {
    parts.push(`Próximo servicio sugerido: ${report.suggestedNextServiceISO}`);
  }

  return parts.join(". ") + ".";
}

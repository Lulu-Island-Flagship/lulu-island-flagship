/**
 * v8.3 Capa 2 del Financial Core — Compliance Sync.
 *
 * Sincronizador entre el feed legal externo (compliance-feed.ts) y la tabla
 * interna de reglas (reglas_legales en compliance-engine.ts). Implementa el
 * flujo completo de aprobación/rechazo con auditoría inmutable.
 *
 * REGLA DE ORO (reforzada aquí):
 *   NUNCA se edita una versión VIGENTE. Los cambios generan nueva versión.
 *   Los asientos históricos quedan ligados a la versión de su momento.
 *
 * Flujo principal:
 *   1. syncFromLegalFeed() — consulta feeds → detecta cambios → propone
 *      versiones PENDIENTES → alerta al admin.
 *   2. getPendingChanges() — lista cambios propuestos no revisados.
 *   3. approveChange(versionId, adminId) — aprueba: vigente_desde = now(),
 *      versión anterior expira (vigente_hasta = now()).
 *   4. rejectChange(versionId, adminId, motivo) — rechaza, registra en
 *      audit_log con motivo.
 *
 * Conexiones:
 *   - compliance-engine.ts → schemas, tipos, ReglaLegalRow.
 *   - compliance-feed.ts  → checkForLegalUpdates, detectChanges,
 *     proposeNewVersion, activateVersion.
 *   - legal-monitoring.ts → LegalFeedFrequency.
 *   - unified-alerts.ts   → publishUnifiedAlert para bandeja del admin.
 */

import { z } from "zod";
import type {
  ReglaLegalRow,
  TipoRegla,
  Jurisdiccion,
} from "./compliance-engine";
import {
  checkForLegalUpdates,
  detectChanges,
  proposeNewVersion,
  type LegalFeedEntry,
  type ProposedVersion,
  type DetectedChange,
  type LegalUpdateCheckResult,
} from "./compliance-feed";
import type { LegalFeedFrequency } from "./legal-monitoring";
import type { PublishUnifiedAlertInput, UnifiedAlertsClient } from "./unified-alerts";

// ---------------------------------------------------------------------------
// Schemas — audit_log
// ---------------------------------------------------------------------------

/** Entrada del audit_log para acciones sobre reglas_legales. */
export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  tabla: z.literal("reglas_legales"),
  registro_id: z.string(),
  accion: z.enum(["APPROVE", "REJECT"]),
  admin_id: z.string(),
  motivo: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string().datetime(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

// ---------------------------------------------------------------------------
// Store interface — abstracción de base de datos
// ---------------------------------------------------------------------------

/**
 * Interfaz abstracta para el almacén de reglas legales y auditoría.
 * La implementación en producción usa Supabase; en tests se usa un
 * store en memoria que satisface esta misma interfaz.
 */
export interface ComplianceStore {
  /** Retorna todas las reglas activas (estado VIGENTE). */
  getActiveRules(): ReglaLegalRow[];

  /** Retorna todas las reglas en estado PENDIENTE. */
  getPendingRules(): ReglaLegalRow[];

  /** Busca una regla por ID. */
  getRuleById(id: string): ReglaLegalRow | null;

  /** Busca la regla VIGENTE para un tipo específico. */
  getActiveRuleByType(tipo: TipoRegla): ReglaLegalRow | null;

  /**
   * Inserta una nueva regla. `id` y `creado_en` se generan automáticamente
   * si no se proveen.
   */
  insertRule(
    rule: Omit<ReglaLegalRow, "id" | "creado_en"> & {
      id?: string;
      creado_en?: string;
    }
  ): ReglaLegalRow;

  /**
   * Actualiza campos mutables de una regla existente.
   * Solo permite modificar estado, vigente_desde, vigente_hasta, notas.
   */
  updateRule(
    id: string,
    updates: Partial<
      Pick<
        ReglaLegalRow,
        "estado" | "vigente_desde" | "vigente_hasta" | "notas"
      >
    >
  ): ReglaLegalRow;

  /** Inserta una entrada inmutable en el audit_log. */
  insertAuditLog(entry: {
    tabla: string;
    registro_id: string;
    accion: string;
    admin_id: string;
    motivo: string | null;
    metadata: Record<string, unknown> | null;
  }): void;
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/** Cambio pendiente de revisión por el admin. */
export interface PendingChange {
  versionId: string;
  tipo: TipoRegla;
  jurisdiccion: Jurisdiccion;
  newVersion: string;
  parametros: Record<string, unknown>;
  changes: DetectedChange[];
  createdAt: string;
  sourceFeed: string;
}

/** Resultado de {@link approveChange}. */
export interface ApprovalResult {
  success: boolean;
  message: string;
  newActiveVersionId: string | null;
  previousVersionId: string | null;
}

/** Resultado de {@link rejectChange}. */
export interface RejectionResult {
  success: boolean;
  message: string;
  versionId: string;
}

/** Resultado de {@link syncFromLegalFeed}. */
export interface SyncResult {
  /** Número de cambios detectados en los feeds. */
  changesDetected: number;
  /** Versiones PENDIENTES generadas. */
  versionsProposed: PendingChange[];
  /** Alertas emitidas a la bandeja unificada. */
  alertsGenerated: number;
  /** Errores no fatales encontrados durante la sincronización. */
  errors: string[];
}

/** Configuración de un feed legal externo. */
export interface FeedConfig {
  /** Identificador de la fuente (ej. "CRA", "BC_ESA", "WORKSAFEBC"). */
  source: string;
  /** Tipo de regla que monitorea este feed. */
  tipo: TipoRegla;
  /** Jurisdicción. */
  jurisdiccion: Jurisdiccion;
  /** Frecuencia de revisión declarada. */
  frequency: LegalFeedFrequency;
  /** URL del endpoint o página de anuncios oficiales. */
  url: string;
  /** Fecha en que se registró este feed en el sistema. */
  createdAt: Date;
  /** Última vez que se consultó exitosamente. null = nunca. */
  lastCheckedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Genera un UUID v4 deterministico a partir de un string semilla. */
function generateVersionId(proposal: ProposedVersion): string {
  // Formato: tipo-version-timestamp truncado para legibilidad
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${proposal.tipo}-${proposal.newVersion}-${ts}-${rand}`;
}

/**
 * Convierte un {@link ProposedVersion} + su source feed en un
 * {@link PendingChange} para la API pública.
 */
function toPendingChange(
  proposal: ProposedVersion,
  sourceFeed: string
): PendingChange {
  return {
    versionId: proposal.id,
    tipo: proposal.tipo,
    jurisdiccion: proposal.jurisdiccion,
    newVersion: proposal.newVersion,
    parametros: proposal.parametros,
    changes: proposal.changes,
    createdAt: proposal.createdAt,
    sourceFeed,
  };
}

// ---------------------------------------------------------------------------
// syncFromLegalFeed()
// ---------------------------------------------------------------------------

/**
 * Consulta los feeds legales configurados, detecta cambios contra las reglas
 * VIGENTES actuales, y propone nuevas versiones en estado PENDIENTE.
 *
 * Por cada feed:
 *   1. Verifica si está overdue/blind ({@link checkForLegalUpdates}).
 *   2. Si tiene entries nuevas, compara contra la regla VIGENTE actual
 *      ({@link detectChanges}).
 *   3. Si hay cambios, crea una propuesta PENDIENTE
 *      ({@link proposeNewVersion}) y la persiste en el store.
 *   4. Genera alerta en bandeja unificada para revisión del admin.
 *
 * REGLA DE ORO: nunca modifica versiones VIGENTES. Solo crea PENDIENTES.
 *
 * @param store - Almacén de reglas (DB en prod, memoria en tests).
 * @param feeds - Configuraciones de feeds a consultar.
 * @param alerts - Cliente de alertas unificadas (opcional; sin él, no se
 *   generan alertas pero el sync sigue funcionando).
 * @param now - Fecha de referencia para el chequeo (default: new Date()).
 */
export function syncFromLegalFeed(
  store: ComplianceStore,
  feeds: FeedConfig[],
  alerts?: UnifiedAlertsClient,
  now: Date = new Date()
): SyncResult {
  const versionsProposed: PendingChange[] = [];
  const errors: string[] = [];
  let changesDetected = 0;
  let alertsGenerated = 0;

  for (const feed of feeds) {
    try {
      // 1. Health-check: ¿está el feed overdue o ciego?
      const health = checkForLegalUpdates(
        feed.lastCheckedAt,
        feed.createdAt,
        feed.frequency,
        now
      );

      // 2. Si el feed está ciego, emitir alerta P1
      if (health.isBlind && alerts) {
        publishAlert(alerts, {
          sourceModule: "compliance-sync",
          sourceTable: "reglas_legales",
          tier: "respond_10min",
          severity: "p1_urgent",
          title: `Feed legal CIEGO: ${feed.source}`,
          summary: `El feed ${feed.source} (${feed.tipo}) lleva más de 30 días sin revisar. Última revisión: ${feed.lastCheckedAt?.toISOString() ?? "nunca"}.`,
        });
        alertsGenerated++;
      }

      // 3. Obtener entradas del feed (simulado → en prod será fetch HTTP)
      const entries = fetchFeedEntries(feed, health);

      // 4. Por cada entrada, detectar cambios vs la regla VIGENTE
      for (const entry of entries) {
        const activeRule = store.getActiveRuleByType(entry.tipo);
        const currentParams = activeRule?.parametros ?? null;

        const change = detectChanges(entry, currentParams);

        if (change.changedKeys.length > 0) {
          changesDetected++;

          // 5. Crear propuesta PENDIENTE
          const proposal = proposeNewVersion(change, `feed-${feed.source}`);

          // 6. Persistir en el store
          const ruleId = generateVersionId(proposal);
          persistProposedVersion(store, proposal, ruleId, feed.source);

          // 7. Alerta al admin
          if (alerts) {
            publishAlert(alerts, {
              sourceModule: "compliance-sync",
              sourceTable: "reglas_legales",
              sourceId: ruleId,
              tier: "can_wait",
              severity: "p2_automatic",
              title: `Nueva versión PENDIENTE: ${feed.tipo}`,
              summary: [
                `Feed: ${feed.source}`,
                `Cambios detectados: ${change.changedKeys.join(", ")}`,
                `Versión propuesta: ${proposal.newVersion}`,
                `Referencia: ${entry.referenceUrl ?? "N/A"}`,
              ].join(" | "),
            });
            alertsGenerated++;
          }

          versionsProposed.push(toPendingChange(proposal, feed.source));
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Feed ${feed.source} (${feed.tipo}): ${message}`);
    }
  }

  return { changesDetected, versionsProposed, alertsGenerated, errors };
}

// ---------------------------------------------------------------------------
// getPendingChanges()
// ---------------------------------------------------------------------------

/**
 * Lista todos los cambios propuestos que aún no han sido revisados
 * (estado PENDIENTE).
 *
 * @param store - Almacén de reglas.
 * @returns Array de cambios pendientes, ordenados del más reciente al más
 *   antiguo por `createdAt`.
 */
export function getPendingChanges(store: ComplianceStore): PendingChange[] {
  const pending = store.getPendingRules();

  return pending
    .map((row): PendingChange => {
      const params = row.parametros as Record<string, unknown>;
      // Reconstruir un DetectedChange mínimo para la UI
      const change: DetectedChange = {
        tipo: row.tipo,
        jurisdiccion: row.jurisdiccion,
        currentParams: null, // la UI puede cargar la versión anterior si la necesita
        newParams: params,
        changedKeys: Object.keys(params),
        source: {
          source: "compliance-sync",
          tipo: row.tipo,
          jurisdiccion: row.jurisdiccion,
          parametros: params,
          publishedAt: row.creado_en,
        },
      };

      return {
        versionId: row.id,
        tipo: row.tipo,
        jurisdiccion: row.jurisdiccion,
        newVersion: row.version,
        parametros: params,
        changes: [change],
        createdAt: row.creado_en,
        sourceFeed: row.notas ?? "manual",
      };
    })
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

// ---------------------------------------------------------------------------
// approveChange()
// ---------------------------------------------------------------------------

/**
 * Aprueba una versión PENDIENTE: la promueve a VIGENTE y expira la versión
 * anterior (vigente_hasta = now()).
 *
 * REGLA DE ORO aplicada:
 *   - La versión PENDIENTE recibe `vigente_desde = now()`, `estado = VIGENTE`.
 *   - La versión VIGENTE anterior recibe `vigente_hasta = now()`,
 *     `estado = HISTORICO`.
 *   - Se registra en audit_log con accion = "APPROVE".
 *
 * @param store - Almacén de reglas.
 * @param versionId - ID de la versión PENDIENTE a aprobar.
 * @param adminId - Identificador del admin que autoriza.
 */
export function approveChange(
  store: ComplianceStore,
  versionId: string,
  adminId: string
): ApprovalResult {
  const now = new Date().toISOString();

  // 1. Validar que la versión existe y está PENDIENTE
  const pendingRule = store.getRuleById(versionId);
  if (!pendingRule) {
    return {
      success: false,
      message: `No se encontró la regla con ID ${versionId}.`,
      newActiveVersionId: null,
      previousVersionId: null,
    };
  }

  if (pendingRule.estado !== "PENDIENTE") {
    return {
      success: false,
      message: `La regla ${versionId} no está PENDIENTE (estado: ${pendingRule.estado}). Solo se pueden aprobar versiones PENDIENTES.`,
      newActiveVersionId: null,
      previousVersionId: null,
    };
  }

  // 2. Buscar la versión actualmente VIGENTE para este tipo
  const currentActive = store.getActiveRuleByType(pendingRule.tipo);

  // 3. Validar que la nueva versión no sea anterior a la vigente
  if (currentActive) {
    const currentDesde = currentActive.vigente_desde
      ? new Date(currentActive.vigente_desde).getTime()
      : 0;
    const newDesde = new Date(now).getTime();
    if (newDesde <= currentDesde) {
      return {
        success: false,
        message: `La nueva versión no puede ser anterior o igual a la vigente (${currentActive.vigente_desde}).`,
        newActiveVersionId: null,
        previousVersionId: currentActive.id,
      };
    }
  }

  // 4. Ejecutar la transición en el store
  try {
    // Marcar versión anterior como HISTORICO con vigente_hasta = now
    if (currentActive) {
      store.updateRule(currentActive.id, {
        estado: "HISTORICO",
        vigente_hasta: now,
      });
    }

    // Activar la nueva versión
    store.updateRule(versionId, {
      estado: "VIGENTE",
      vigente_desde: now,
      vigente_hasta: null,
    });

    // 5. Registrar en audit_log
    store.insertAuditLog({
      tabla: "reglas_legales",
      registro_id: versionId,
      accion: "APPROVE",
      admin_id: adminId,
      motivo: null,
      metadata: {
        tipo: pendingRule.tipo,
        version: pendingRule.version,
        previous_version_id: currentActive?.id ?? null,
      },
    });

    return {
      success: true,
      message: currentActive
        ? `Versión ${versionId} aprobada y activada. La versión anterior ${currentActive.id} expiró (vigente_hasta=${now}).`
        : `Versión ${versionId} aprobada como primera versión VIGENTE para ${pendingRule.tipo}.`,
      newActiveVersionId: versionId,
      previousVersionId: currentActive?.id ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Error al aprobar: ${message}`,
      newActiveVersionId: null,
      previousVersionId: null,
    };
  }
}

// ---------------------------------------------------------------------------
// rejectChange()
// ---------------------------------------------------------------------------

/**
 * Rechaza una versión PENDIENTE: la marca como HISTORICO (rechazada) sin
 * modificar la versión VIGENTE actual.
 *
 * REGLA DE ORO: la versión VIGENTE NO se toca.
 *
 * @param store - Almacén de reglas.
 * @param versionId - ID de la versión PENDIENTE a rechazar.
 * @param adminId - Identificador del admin que rechaza.
 * @param motivo - Razón del rechazo (obligatorio para trazabilidad).
 */
export function rejectChange(
  store: ComplianceStore,
  versionId: string,
  adminId: string,
  motivo: string
): RejectionResult {
  // 1. Validar que la versión existe y está PENDIENTE
  const pendingRule = store.getRuleById(versionId);
  if (!pendingRule) {
    return {
      success: false,
      message: `No se encontró la regla con ID ${versionId}.`,
      versionId,
    };
  }

  if (pendingRule.estado !== "PENDIENTE") {
    return {
      success: false,
      message: `La regla ${versionId} no está PENDIENTE (estado: ${pendingRule.estado}). Solo se pueden rechazar versiones PENDIENTES.`,
      versionId,
    };
  }

  // 2. Validar que el motivo no esté vacío
  if (!motivo.trim()) {
    return {
      success: false,
      message: "Se requiere un motivo para rechazar un cambio.",
      versionId,
    };
  }

  // 3. Marcar como HISTORICO (rechazada). La versión VIGENTE no se toca.
  try {
    store.updateRule(versionId, {
      estado: "HISTORICO",
      notas: `RECHAZADO por ${adminId}: ${motivo}`,
    });

    // 4. Registrar en audit_log
    store.insertAuditLog({
      tabla: "reglas_legales",
      registro_id: versionId,
      accion: "REJECT",
      admin_id: adminId,
      motivo,
      metadata: {
        tipo: pendingRule.tipo,
        version: pendingRule.version,
      },
    });

    return {
      success: true,
      message: `Versión ${versionId} rechazada. Motivo: ${motivo}`,
      versionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Error al rechazar: ${message}`,
      versionId,
    };
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Simula la consulta HTTP al feed legal externo.
 *
 * En producción, esta función hará fetch a la API real de CRA, BC Gov,
 * o WorkSafeBC. Por ahora, devuelve las entradas hardcodeadas que
 * representan los valores publicados más recientes.
 *
 * @param feed - Configuración del feed a consultar.
 * @param health - Resultado del health-check previo.
 */
function fetchFeedEntries(
  feed: FeedConfig,
  _health: LegalUpdateCheckResult
): LegalFeedEntry[] {
  // En producción, esto es un fetch HTTP.
  // Por ahora, simulamos con datos conocidos para 2026.
  const now = new Date().toISOString();

  switch (feed.source) {
    case "CRA":
      return [
        {
          source: "CRA",
          tipo: "CPP",
          jurisdiccion: "Federal",
          parametros: {
            tasa_empleado: 0.0595,
            tope: 74600,
            exencion_basica: 3500,
          },
          publishedAt: now,
          referenceUrl: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/cpp-contribution-rates-maximums-exemptions.html",
          effectiveDate: "2026-01-01",
        },
        {
          source: "CRA",
          tipo: "EI",
          jurisdiccion: "Federal",
          parametros: {
            tasa_empleado: 0.0163,
            tope: 68900,
            tasa_employer: 1.4,
          },
          publishedAt: now,
          referenceUrl: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei/ei-premium-rates-maximums.html",
          effectiveDate: "2026-01-01",
        },
        {
          source: "CRA",
          tipo: "GST",
          jurisdiccion: "Federal",
          parametros: { tasa: 0.05 },
          publishedAt: now,
          referenceUrl: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html",
        },
      ];

    case "BC_ESA":
      return [
        {
          source: "BC_ESA",
          tipo: "MinWage",
          jurisdiccion: "BC",
          parametros: {
            hourly_rate: 18.25,
            effective_date: "2026-06-01",
          },
          publishedAt: now,
          referenceUrl: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/minimum-wage",
          effectiveDate: "2026-06-01",
        },
        {
          source: "BC_ESA",
          tipo: "VacationPay",
          jurisdiccion: "BC",
          parametros: {
            rate_under_5y: 0.04,
            rate_5y_plus: 0.06,
          },
          publishedAt: now,
          referenceUrl: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/vacation",
        },
        {
          source: "BC_ESA",
          tipo: "StatutoryHolidays",
          jurisdiccion: "BC",
          parametros: {
            total_days: 11,
            jurisdiction: "BC",
            pay_rule:
              "average_day_pay: salario total ganado en 30 días anteriores ÷ días trabajados. " +
              "Si trabaja el festivo: 1.5× horas trabajadas + average day's pay.",
          },
          publishedAt: now,
          referenceUrl: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays",
        },
      ];

    case "WORKSAFEBC":
      return [
        {
          source: "WORKSAFEBC",
          tipo: "WorkSafeBC",
          jurisdiccion: "BC",
          parametros: {
            class_rate: 2.15,
            class_code: "12345",
          },
          publishedAt: now,
          referenceUrl: "https://www.worksafebc.com/en/insurance/industries",
          effectiveDate: "2026-01-01",
        },
      ];

    default:
      return [];
  }
}

/**
 * Persiste una propuesta de nueva versión en el store como regla PENDIENTE.
 */
function persistProposedVersion(
  store: ComplianceStore,
  proposal: ProposedVersion,
  ruleId: string,
  source: string
): void {
  const now = new Date().toISOString();

  store.insertRule({
    id: ruleId,
    jurisdiccion: proposal.jurisdiccion,
    tipo: proposal.tipo,
    version: proposal.newVersion,
    parametros: proposal.parametros,
    estado: "PENDIENTE",
    vigente_desde: null,
    vigente_hasta: null,
    creado_por: `compliance-sync:${source}`,
    creado_en: now,
    notas: `Propuesta automática desde feed ${source}. ${proposal.changes.length} cambio(s) detectado(s).`,
  });
}

/**
 * Publica una alerta en la bandeja unificada. No lanza si falla (la alerta
 * es secundaria, nunca debe tumbar el sync).
 */
function publishAlert(
  alerts: UnifiedAlertsClient,
  input: PublishUnifiedAlertInput
): void {
  try {
    // Fire-and-forget: la alerta no debe bloquear el flujo principal.
    alerts
      .from("unified_alerts")
      .insert({
        source_module: input.sourceModule,
        source_table: input.sourceTable ?? null,
        source_id: input.sourceId ?? null,
        tier: input.tier,
        severity: input.severity,
        title: input.title,
        summary: input.summary ?? null,
      })
      .select()
      .single();
  } catch {
    // Silencioso: la integridad del sync no depende de la alerta.
  }
}

// ---------------------------------------------------------------------------
// Feed configurations — catálogo oficial de fuentes
// ---------------------------------------------------------------------------

/** Feeds legales canónicos que el sistema monitorea. */
export const CANONICAL_FEEDS: FeedConfig[] = [
  {
    source: "CRA",
    tipo: "CPP",
    jurisdiccion: "Federal",
    frequency: "monthly",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions.html",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
  {
    source: "CRA",
    tipo: "EI",
    jurisdiccion: "Federal",
    frequency: "monthly",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/employment-insurance-ei.html",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
  {
    source: "CRA",
    tipo: "GST",
    jurisdiccion: "Federal",
    frequency: "monthly",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
  {
    source: "BC_ESA",
    tipo: "MinWage",
    jurisdiccion: "BC",
    frequency: "monthly",
    url: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/minimum-wage",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
  {
    source: "BC_ESA",
    tipo: "VacationPay",
    jurisdiccion: "BC",
    frequency: "monthly",
    url: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/vacation",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
  {
    source: "BC_ESA",
    tipo: "StatutoryHolidays",
    jurisdiccion: "BC",
    frequency: "monthly",
    url: "https://www2.gov.bc.ca/gov/content/employment-business/employment-standards-advice/employment-standards/statutory-holidays",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
  {
    source: "WORKSAFEBC",
    tipo: "WorkSafeBC",
    jurisdiccion: "BC",
    frequency: "monthly",
    url: "https://www.worksafebc.com/en/insurance/industries",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    lastCheckedAt: null,
  },
];

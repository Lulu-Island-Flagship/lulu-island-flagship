/**
 * v8.3 G.8 — Panel de Salud del Sistema (6 Semáforos).
 *
 * Grid 2×4 (o 3×2) de semáforos en tiempo real que cubren:
 *   1. Despacho     — % capacidad utilizada.
 *   2. Inventario   — ítems bajo mínimo de reposición.
 *   3. Empleados    — empleados en bench (sin asignación).
 *   4. Legal        — feeds regulatorios actualizados.
 *   5. Pagos        — sincronización QBO al día.
 *   6. PWA Sync     — dispositivos con sync pendiente.
 *
 * Cada semáforo tiene drill-down: al hacer clic, el admin ve el detalle
 * de qué está pasando en ese subsistema.
 *
 * Conecta:
 *   - observability.ts     → logging y estado de Sentry.
 *   - backup-jobs.ts       → estado de backups (due/overdue).
 *   - legal-monitoring.ts  → ceguera de feeds legales.
 *   - qbo-sync.ts          → divergencia Shadow Ledger vs QBO.
 *   - inventory-reorder.ts → ítems bajo umbral.
 *   - pwa-heartbeat.ts     → dispositivos sin heartbeat.
 *
 * Diseño: funciones puras que reciben snapshots de cada subsistema y
 * devuelven un HealthPanel completo con semáforos y drill-down data.
 */

import type { Semaphore } from "@/lib/dashboard-metrics";
import type { BackupDueStatus } from "@/lib/backup-jobs";
import type { DivergenceEvaluation } from "@/lib/qbo-sync";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** ID de cada subsistema monitoreado. */
export const HEALTH_SUBSYSTEMS = [
  "despacho",
  "inventario",
  "empleados",
  "legal",
  "pagos",
  "pwa_sync",
] as const;

export type HealthSubsystem = (typeof HEALTH_SUBSYSTEMS)[number];

export const SUBSYSTEM_LABELS: Record<HealthSubsystem, string> = {
  despacho: "Despacho",
  inventario: "Inventario",
  empleados: "Empleados",
  legal: "Legal",
  pagos: "Pagos",
  pwa_sync: "PWA Sync",
};

/** Umbrales para cada subsistema. */
export const HEALTH_THRESHOLDS = {
  /** % de capacidad utilizada en despacho. >85% es amarillo, >95% rojo. */
  dispatchCapacityWarningPercent: 85,
  dispatchCapacityCriticalPercent: 95,
  /** Ítems bajo mínimo: 0 = verde, 1-3 = amarillo, 4+ = rojo. */
  inventoryWarningCount: 1,
  inventoryCriticalCount: 4,
  /** Empleados en bench: 0 = rojo (sin holgura), 1-2 = amarillo, 3+ = verde. */
  benchCriticalCount: 0,
  benchWarningCount: 2,
  benchHealthyCount: 3,
  /** Días sin revisar feed legal: >7 amarillo, >30 rojo (ciego). */
  legalWarningDays: 7,
  legalCriticalDays: 30,
  /** Divergencia Shadow Ledger vs QBO: >0.1% amarillo, >1% rojo. */
  qboWarningDivergence: 0.001,
  qboCriticalDivergence: 0.01,
  /** Dispositivos PWA con sync pendiente >24h: 1-2 amarillo, 3+ rojo. */
  pwaWarningPendingCount: 1,
  pwaCriticalPendingCount: 3,
} as const;

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

export interface SubsystemHealth {
  subsystem: HealthSubsystem;
  label: string;
  semaphore: Semaphore;
  /** Valor principal para mostrar (ej. "78%", "3 ítems", "OK"). */
  primaryValue: string;
  /** Valor secundario (ej. "Capacidad: 22/28 equipos"). */
  secondaryValue?: string;
  /** Detalle para el drill-down. */
  drillDown: SubsystemDrillDown;
}

export interface SubsystemDrillDown {
  summary: string;
  details: string[];
  /** Acción recomendada si el semáforo no es verde. */
  recommendedAction?: string;
  /** Ruta en el admin panel. */
  adminRoute: string;
}

export interface SystemHealthPanel {
  generatedAt: string;
  subsystems: SubsystemHealth[];
  /** true si todos los semáforos están en verde. */
  allGreen: boolean;
  /** Cantidad de subsistemas en cada estado. */
  summary: HealthSummary;
}

export interface HealthSummary {
  green: number;
  yellow: number;
  red: number;
  unknown: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Inputs por subsistema
// ═══════════════════════════════════════════════════════════════════════════

export interface DispatchHealthInput {
  /** Equipos actualmente asignados (committed). */
  committedTeams: number;
  /** Capacidad máxima de equipos (max_teams). */
  maxTeams: number;
  /** Órdenes pendientes de asignación. */
  pendingAssignments: number;
}

export interface InventoryHealthInput {
  /** Ítems con stock bajo el umbral de reposición. */
  itemsBelowThreshold: number;
  /** Total de ítems en el catálogo. */
  totalItems: number;
  /** Ítems con stock en cero (crítico). */
  itemsOutOfStock: number;
}

export interface EmployeeHealthInput {
  /** Empleados activos en bench (sin asignación hoy). */
  benchCount: number;
  /** Total de empleados activos. */
  totalActive: number;
  /** Empleados en observación o suspendidos. */
  underReviewCount: number;
}

export interface LegalHealthInput {
  /** Días desde la última revisión del feed más atrasado. */
  daysSinceLastCheck: number;
  /** true si algún feed está ciego (>30 días sin revisar, de pipeda.ts). */
  anyFeedBlind: boolean;
  /** Cantidad de feeds configurados. */
  totalFeeds: number;
  /** Feeds atrasados según su frecuencia declarada. */
  overdueFeedsCount: number;
}

export interface PaymentHealthInput {
  /** Evaluación de divergencia Shadow Ledger vs QBO. */
  divergence: DivergenceEvaluation;
  /** Órdenes pendientes de exportar a QBO. */
  pendingSyncCount: number;
  /** Órdenes que agotaron reintentos (give_up). */
  failedSyncCount: number;
}

export interface PwaSyncHealthInput {
  /** Dispositivos con sync pendiente >24h. */
  pendingSyncDevices: number;
  /** Total de dispositivos registrados. */
  totalDevices: number;
  /** Dispositivos sin heartbeat en >15 min (de pwa-heartbeat.ts). */
  missingHeartbeatDevices: number;
}

export interface SystemHealthInput {
  dispatch: DispatchHealthInput;
  inventory: InventoryHealthInput;
  employees: EmployeeHealthInput;
  legal: LegalHealthInput;
  payments: PaymentHealthInput;
  pwaSync: PwaSyncHealthInput;
  /** Estado de backups (opcional — si no se provee, el semáforo de pagos cubre backup como sub-item). */
  backups?: BackupDueStatus[];
  /** true si Sentry está configurado y reportando. */
  sentryConfigured: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Evaluación por subsistema
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evalúa la salud del subsistema de Despacho.
 * Semáforo basado en % de capacidad utilizada.
 */
export function evaluateDispatchHealth(input: DispatchHealthInput): SubsystemHealth {
  const utilizationPercent =
    input.maxTeams > 0 ? Math.round((input.committedTeams / input.maxTeams) * 100) : 0;

  let semaphore: Semaphore;
  if (input.maxTeams <= 0) {
    semaphore = "unknown";
  } else if (utilizationPercent >= HEALTH_THRESHOLDS.dispatchCapacityCriticalPercent) {
    semaphore = "red";
  } else if (utilizationPercent >= HEALTH_THRESHOLDS.dispatchCapacityWarningPercent) {
    semaphore = "yellow";
  } else {
    semaphore = "green";
  }

  const details: string[] = [
    `Equipos asignados: ${input.committedTeams} / ${input.maxTeams} (${utilizationPercent}%)`,
    `Órdenes pendientes de asignación: ${input.pendingAssignments}`,
  ];

  let recommendedAction: string | undefined;
  if (semaphore === "red") {
    recommendedAction =
      "Capacidad crítica. Considere: (A) activar equipo extra, (B) rechazar nuevas órdenes en esta zona, (C) extender ventanas horarias.";
  } else if (semaphore === "yellow") {
    recommendedAction =
      "Capacidad elevada. Monitorear — si cruza 95% se debe activar plan de contingencia.";
  }

  return {
    subsystem: "despacho",
    label: SUBSYSTEM_LABELS.despacho,
    semaphore,
    primaryValue: `${utilizationPercent}%`,
    secondaryValue: `${input.committedTeams}/${input.maxTeams} equipos`,
    drillDown: {
      summary:
        semaphore === "green"
          ? "Despacho operando dentro de capacidad."
          : `Despacho al ${utilizationPercent}% de capacidad.`,
      details,
      recommendedAction,
      adminRoute: "/admin/dispatch/capacity",
    },
  };
}

/**
 * Evalúa la salud del subsistema de Inventario.
 * Semáforo basado en cantidad de ítems bajo mínimo.
 */
export function evaluateInventoryHealth(input: InventoryHealthInput): SubsystemHealth {
  let semaphore: Semaphore;
  if (input.itemsOutOfStock > 0 || input.itemsBelowThreshold >= HEALTH_THRESHOLDS.inventoryCriticalCount) {
    semaphore = "red";
  } else if (input.itemsBelowThreshold >= HEALTH_THRESHOLDS.inventoryWarningCount) {
    semaphore = "yellow";
  } else {
    semaphore = "green";
  }

  const details: string[] = [
    `Ítems bajo mínimo: ${input.itemsBelowThreshold} / ${input.totalItems}`,
    input.itemsOutOfStock > 0
      ? `⚠️ ${input.itemsOutOfStock} ítems sin stock (crítico).`
      : "Sin ítems agotados.",
  ];

  let recommendedAction: string | undefined;
  if (semaphore === "red") {
    recommendedAction =
      "Generar órdenes de compra urgentes para ítems agotados o bajo mínimo crítico. Verificar consumo proyectado contra servicios agendados.";
  } else if (semaphore === "yellow") {
    recommendedAction = "Revisar ítems bajo mínimo y planificar reposición antes de que se agoten.";
  }

  return {
    subsystem: "inventario",
    label: SUBSYSTEM_LABELS.inventario,
    semaphore,
    primaryValue: `${input.itemsBelowThreshold} ítems`,
    secondaryValue: input.itemsOutOfStock > 0 ? `${input.itemsOutOfStock} agotados` : "Stock OK",
    drillDown: {
      summary:
        semaphore === "green"
          ? "Inventario saludable — todos los ítems sobre el mínimo."
          : `${input.itemsBelowThreshold} ítems bajo el umbral de reposición.`,
      details,
      recommendedAction,
      adminRoute: "/admin/inventory/reorder",
    },
  };
}

/**
 * Evalúa la salud del subsistema de Empleados.
 * Semáforo basado en disponibilidad de bench (holgura de personal).
 *
 * Nota: a diferencia de los otros semáforos, aquí "rojo" significa poca
 * holgura (benchCount bajo), no mucha. Tener 0 personas en bench es
 * peligroso: cualquier ausencia deja un servicio sin cubrir.
 */
export function evaluateEmployeeHealth(input: EmployeeHealthInput): SubsystemHealth {
  let semaphore: Semaphore;
  if (input.benchCount <= HEALTH_THRESHOLDS.benchCriticalCount) {
    semaphore = "red";
  } else if (input.benchCount <= HEALTH_THRESHOLDS.benchWarningCount) {
    semaphore = "yellow";
  } else {
    semaphore = "green";
  }

  const details: string[] = [
    `Bench disponible: ${input.benchCount} empleados`,
    `Total activos: ${input.totalActive}`,
    input.underReviewCount > 0
      ? `${input.underReviewCount} empleados en observación/suspendidos.`
      : "Sin empleados bajo revisión.",
  ];

  let recommendedAction: string | undefined;
  if (semaphore === "red") {
    recommendedAction =
      "Sin holgura de personal. Cualquier ausencia deja servicios sin cubrir. Considere contratar o activar personal part-time.";
  } else if (semaphore === "yellow") {
    recommendedAction = "Holgura baja. Si un empleado se enferma, puede haber fricción en el despacho.";
  }

  return {
    subsystem: "empleados",
    label: SUBSYSTEM_LABELS.empleados,
    semaphore,
    primaryValue: `${input.benchCount} en bench`,
    secondaryValue: `${input.totalActive} activos`,
    drillDown: {
      summary:
        semaphore === "green"
          ? "Holgura de personal saludable."
          : `Solo ${input.benchCount} empleados disponibles para cubrir ausencias.`,
      details,
      recommendedAction,
      adminRoute: "/admin/teams/bench",
    },
  };
}

/**
 * Evalúa la salud del subsistema Legal.
 * Semáforo basado en días desde la última revisión de feeds regulatorios.
 */
export function evaluateLegalHealth(input: LegalHealthInput): SubsystemHealth {
  let semaphore: Semaphore;
  if (input.anyFeedBlind || input.daysSinceLastCheck >= HEALTH_THRESHOLDS.legalCriticalDays) {
    semaphore = "red";
  } else if (input.daysSinceLastCheck >= HEALTH_THRESHOLDS.legalWarningDays) {
    semaphore = "yellow";
  } else {
    semaphore = "green";
  }

  const details: string[] = [
    `Última revisión: hace ${input.daysSinceLastCheck} días`,
    `Feeds configurados: ${input.totalFeeds}`,
    input.overdueFeedsCount > 0
      ? `${input.overdueFeedsCount} feeds atrasados según su frecuencia.`
      : "Todos los feeds al día.",
    input.anyFeedBlind
      ? "⚠️ Al menos un feed está CIEGO (>30 días sin revisar)."
      : "Ningún feed está ciego.",
  ];

  let recommendedAction: string | undefined;
  if (semaphore === "red") {
    recommendedAction =
      "URGENTE: Revisar feeds legales inmediatamente. Un feed ciego puede significar incumplimiento regulatorio no detectado (WorkSafeBC, Health Canada, CRA).";
  } else if (semaphore === "yellow") {
    recommendedAction = "Programar revisión de feeds legales esta semana para evitar que se vuelvan ciegos.";
  }

  return {
    subsystem: "legal",
    label: SUBSYSTEM_LABELS.legal,
    semaphore,
    primaryValue: input.anyFeedBlind ? "CIEGO" : `${input.daysSinceLastCheck}d`,
    secondaryValue: input.overdueFeedsCount > 0 ? `${input.overdueFeedsCount} atrasados` : "Al día",
    drillDown: {
      summary:
        semaphore === "green"
          ? "Monitoreo legal al día."
          : input.anyFeedBlind
            ? "Al menos un feed regulatorio está ciego — riesgo de incumplimiento."
            : `Última revisión hace ${input.daysSinceLastCheck} días.`,
      details,
      recommendedAction,
      adminRoute: "/admin/legal/feeds",
    },
  };
}

/**
 * Evalúa la salud del subsistema de Pagos (QBO Sync).
 * Semáforo basado en divergencia Shadow Ledger vs QBO y órdenes pendientes.
 */
export function evaluatePaymentHealth(input: PaymentHealthInput): SubsystemHealth {
  let semaphore: Semaphore;
  if (
    input.divergence.divergenceRatio >= HEALTH_THRESHOLDS.qboCriticalDivergence ||
    input.failedSyncCount > 5
  ) {
    semaphore = "red";
  } else if (
    input.divergence.divergenceRatio >= HEALTH_THRESHOLDS.qboWarningDivergence ||
    input.pendingSyncCount > 10
  ) {
    semaphore = "yellow";
  } else {
    semaphore = "green";
  }

  const divergenceDisplay = `${round2(input.divergence.divergenceRatio * 100)}%`;

  const details: string[] = [
    `Divergencia Shadow Ledger vs QBO: ${divergenceDisplay}`,
    `Órdenes pendientes de sync: ${input.pendingSyncCount}`,
    input.failedSyncCount > 0
      ? `Órdenes con sync fallido (sin reintentos): ${input.failedSyncCount}`
      : "Sin fallos de sync.",
  ];

  let recommendedAction: string | undefined;
  if (semaphore === "red") {
    recommendedAction =
      "URGENTE: Divergencia contable detectada. Conciliar manualmente Shadow Ledger vs QBO antes del cierre del día.";
  } else if (semaphore === "yellow") {
    recommendedAction =
      "Revisar órdenes pendientes de sync. Si la divergencia crece, programar conciliación manual.";
  }

  return {
    subsystem: "pagos",
    label: SUBSYSTEM_LABELS.pagos,
    semaphore,
    primaryValue: input.divergence.exceedsThreshold ? divergenceDisplay : "OK",
    secondaryValue:
      input.pendingSyncCount > 0 ? `${input.pendingSyncCount} pendientes` : "Sincronizado",
    drillDown: {
      summary:
        semaphore === "green"
          ? "Pagos sincronizados — sin divergencia entre Shadow Ledger y QBO."
          : `Divergencia QBO: ${divergenceDisplay}. ${input.pendingSyncCount} órdenes pendientes.`,
      details,
      recommendedAction,
      adminRoute: "/admin/payments/qbo-sync",
    },
  };
}

/**
 * Evalúa la salud del subsistema de PWA Sync.
 * Semáforo basado en dispositivos con sync pendiente >24h y heartbeats perdidos.
 */
export function evaluatePwaSyncHealth(input: PwaSyncHealthInput): SubsystemHealth {
  const pendingTotal = input.pendingSyncDevices + input.missingHeartbeatDevices;

  let semaphore: Semaphore;
  if (
    input.missingHeartbeatDevices > 0 ||
    pendingTotal >= HEALTH_THRESHOLDS.pwaCriticalPendingCount
  ) {
    semaphore = "red";
  } else if (pendingTotal >= HEALTH_THRESHOLDS.pwaWarningPendingCount) {
    semaphore = "yellow";
  } else {
    semaphore = "green";
  }

  const details: string[] = [
    `Dispositivos registrados: ${input.totalDevices}`,
    `Sync pendiente >24h: ${input.pendingSyncDevices}`,
    input.missingHeartbeatDevices > 0
      ? `⚠️ ${input.missingHeartbeatDevices} dispositivos sin heartbeat (>15 min).`
      : "Todos los heartbeats al día.",
  ];

  let recommendedAction: string | undefined;
  if (input.missingHeartbeatDevices > 0) {
    recommendedAction = `URGENTE: ${input.missingHeartbeatDevices} dispositivos sin heartbeat. Verificar bienestar de empleados en campo (WorkSafeBC OHS 4.22).`;
  } else if (semaphore === "yellow") {
    recommendedAction =
      "Dispositivos con sync pendiente. Puede indicar problemas de conectividad en campo.";
  }

  return {
    subsystem: "pwa_sync",
    label: SUBSYSTEM_LABELS.pwa_sync,
    semaphore,
    primaryValue: input.missingHeartbeatDevices > 0 ? "⚠️ Heartbeat" : `${pendingTotal} pend.`,
    secondaryValue: `${input.totalDevices} dispositivos`,
    drillDown: {
      summary:
        semaphore === "green"
          ? "PWA Sync al día — todos los dispositivos sincronizados."
          : `${pendingTotal} dispositivos con sync pendiente o heartbeat perdido.`,
      details,
      recommendedAction,
      adminRoute: "/admin/system/pwa-sync",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Builder del panel completo
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye el panel de salud completo con los 6 semáforos evaluados.
 *
 * @param input — snapshots de cada subsistema.
 * @param nowIso — timestamp de generación.
 */
export function buildSystemHealthPanel(
  input: SystemHealthInput,
  nowIso: string
): SystemHealthPanel {
  const subsystems: SubsystemHealth[] = [
    evaluateDispatchHealth(input.dispatch),
    evaluateInventoryHealth(input.inventory),
    evaluateEmployeeHealth(input.employees),
    evaluateLegalHealth(input.legal),
    evaluatePaymentHealth(input.payments),
    evaluatePwaSyncHealth(input.pwaSync),
  ];

  const summary: HealthSummary = {
    green: subsystems.filter((s) => s.semaphore === "green").length,
    yellow: subsystems.filter((s) => s.semaphore === "yellow").length,
    red: subsystems.filter((s) => s.semaphore === "red").length,
    unknown: subsystems.filter((s) => s.semaphore === "unknown").length,
  };

  return {
    generatedAt: nowIso,
    subsystems,
    allGreen: summary.red === 0 && summary.yellow === 0 && summary.unknown === 0,
    summary,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

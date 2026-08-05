/**
 * v8.3 G.1 — Command Center Unificado.
 *
 * Dashboard consolidado que unifica los widgets del admin en una sola vista
 * con jerarquía visual: lo urgente arriba, lo informativo abajo.
 *
 * Compone métricas de:
 *   - dashboard-metrics.ts   → tasa sin disputas, batch-capture, score equipos, margen
 *   - unified-alerts.ts       → alertas abiertas, priorización
 *   - cash-reserve.ts         → caja operativa, reserva de impuestos, fondo emergencia
 *   - shadow-ledger.ts        → neto real vía replayOrderBalance
 *   - legal-monitoring.ts     → próximos vencimientos legales
 *   - succession.ts           → alerta burnout/sucesión
 *
 * Diseño: funciones puras que reciben snapshots pre-consultados por el route
 * handler y devuelven un CommandCenterSnapshot estructurado con jerarquía.
 * Nunca toca la base de datos — el caller hace los queries y pasa los datos.
 * Cada función es testeable sin DB, mismo patrón que dashboard-metrics.ts.
 */

import type { Semaphore } from "@/lib/dashboard-metrics";
import { DASHBOARD_THRESHOLDS, semaphoreForMinThreshold } from "@/lib/dashboard-metrics";
import type { UnifiedAlertSeverity, UnifiedAlertTier } from "@/lib/unified-alerts";
import { sortAlertsBySeverity } from "@/lib/unified-alerts";
import { TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL } from "@/lib/cash-reserve";

// ---------------------------------------------------------------------------
// Tipos de dominio del Command Center
// ---------------------------------------------------------------------------

/** Nivel de urgencia visual para widgets del Command Center. */
export type WidgetPriority = "p0_critical" | "p1_urgent" | "p2_info" | "p3_background";

/** Una métrica individual dentro del Command Center. */
export interface CommandCenterMetric {
  id: string;
  label: string;
  value: string;
  secondary?: string;
  semaphore: Semaphore;
  priority: WidgetPriority;
  /** Ruta de drill-down en el admin panel. */
  drillDownHref?: string;
}

/** Agrupación lógica de métricas relacionadas. */
export interface CommandCenterGroup {
  id: string;
  label: string;
  priority: WidgetPriority;
  metrics: CommandCenterMetric[];
}

/** Snapshot completo del Command Center, listo para renderizar. */
export interface CommandCenterSnapshot {
  generatedAt: string;
  groups: CommandCenterGroup[];
  /** Alertas abiertas ordenadas por severidad (P0 primero). */
  openAlerts: CommandCenterAlertDigest[];
  /** Próximos vencimientos legales. */
  upcomingLegalDeadlines: LegalDeadlineDigest[];
  /** Estado de sucesión (burnout / auto-activate). */
  successionStatus: string | null;
}

export interface CommandCenterAlertDigest {
  id: string;
  tier: UnifiedAlertTier;
  severity: UnifiedAlertSeverity;
  title: string;
  summary: string | null;
  sourceModule: string;
  createdAt: string;
}

export interface LegalDeadlineDigest {
  feed: string;
  lastCheckedAt: string | null;
  nextCheckDueBy: string;
  daysUntilDue: number;
  blind: boolean;
  priority: WidgetPriority;
}

// ---------------------------------------------------------------------------
// Inputs agregados
// ---------------------------------------------------------------------------

export interface CommandCenterInput {
  /** De dashboard-metrics.ts */
  disputeFreeRatePercent: number | null;
  batchCaptureSuccessRatePercent: number | null;
  teamScoreAverage: number | null;
  contributionMarginPercent: number | null;
  netMarginPercent: number | null;
  /** De cash-reserve.ts + shadow-ledger */
  cashOnHandCents: number;
  taxReserveCents: number;
  emergencyFundMonths: number;
  /** De unified-alerts.ts */
  openAlertCount: number;
  alertsRequiringResponse: number;
  /** De shadow-ledger.ts */
  monthlyRevenueCents: number;
  monthlyNetCents: number;
  /** De dispatch — conteos del día */
  activeServicesCount: number;
  teamsInFieldCount: number;
  servicesInProgressCount: number;
  servicesCompletedToday: number;
  /** QC */
  qcScoreToday: number | null;
  openDisputesCount: number;
  /** Fixed costs for margin calculation */
  fixedCostPerServiceDollars: number | null;
  fixedCostsConfigured: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

/**
 * Construye el snapshot completo del Command Center a partir de los datos
 * ya consultados por el route handler. La jerarquía es fija: lo urgente
 * (alertas, caja bajo mínimo) arriba; lo informativo (margen, QC) debajo.
 */
export function buildCommandCenterSnapshot(
  input: CommandCenterInput,
  alerts: CommandCenterAlertDigest[],
  legalDeadlines: LegalDeadlineDigest[],
  successionStatus: string | null,
  nowIso: string
): CommandCenterSnapshot {
  const groups: CommandCenterGroup[] = [];

  // ── Grupo 0: Estado operativo inmediato (P0) ──
  groups.push({
    id: "live-ops",
    label: "En vivo",
    priority: "p0_critical",
    metrics: buildLiveOpsMetrics(input),
  });

  // ── Grupo 1: Caja y fondo de emergencia (P0 si está bajo) ──
  groups.push({
    id: "cash-position",
    label: "Caja",
    priority: input.emergencyFundMonths < 2 ? "p0_critical" : "p1_urgent",
    metrics: buildCashMetrics(input),
  });

  // ── Grupo 2: KPIs financieros (P1) ──
  groups.push({
    id: "kpi-financial",
    label: "KPIs",
    priority: "p1_urgent",
    metrics: buildFinancialKpiMetrics(input),
  });

  // ── Grupo 3: Calidad y disputas (P1-P2) ──
  groups.push({
    id: "quality-disputes",
    label: "Calidad",
    priority: input.openDisputesCount > 0 ? "p1_urgent" : "p2_info",
    metrics: buildQualityMetrics(input),
  });

  // ── Grupo 4: Semáforos del sistema (P2) ──
  groups.push({
    id: "system-health",
    label: "Sistema",
    priority: "p2_info",
    metrics: buildSystemHealthSummary(input),
  });

  const sortedAlerts = sortAlertsBySeverity(
    alerts.map((a) => ({ severity: a.severity, created_at: a.createdAt })),
  ) as unknown as CommandCenterAlertDigest[];

  return {
    generatedAt: nowIso,
    groups,
    openAlerts: sortedAlerts,
    upcomingLegalDeadlines: legalDeadlines.sort((a, b) => a.daysUntilDue - b.daysUntilDue),
    successionStatus,
  };
}

// ---------------------------------------------------------------------------
// Builders por grupo
// ---------------------------------------------------------------------------

function buildLiveOpsMetrics(input: CommandCenterInput): CommandCenterMetric[] {
  const hasAlerts = input.alertsRequiringResponse > 0;

  return [
    {
      id: "active-services",
      label: "Servicios activos",
      value: String(input.activeServicesCount),
      secondary: `${input.servicesInProgressCount} en progreso · ${input.servicesCompletedToday} completado${input.servicesCompletedToday !== 1 ? "s" : ""}`,
      semaphore: "green",
      priority: "p0_critical",
      drillDownHref: "/admin/dispatch",
    },
    {
      id: "field-teams",
      label: "Equipos en campo",
      value: String(input.teamsInFieldCount),
      semaphore: input.teamsInFieldCount > 0 ? "green" : "unknown",
      priority: "p0_critical",
      drillDownHref: "/admin/dispatch",
    },
    {
      id: "open-alerts",
      label: "Alertas activas",
      value: String(input.openAlertCount),
      secondary: hasAlerts ? `${input.alertsRequiringResponse} requieren respuesta` : undefined,
      semaphore: hasAlerts ? "red" : "green",
      priority: "p0_critical",
      drillDownHref: "/admin/alerts",
    },
  ];
}

function buildCashMetrics(input: CommandCenterInput): CommandCenterMetric[] {
  const cashDollars = input.cashOnHandCents / 100;
  const reserveDollars = input.taxReserveCents / 100;
  const operationalCash = cashDollars - reserveDollars;

  const fundSemaphore: Semaphore =
    input.emergencyFundMonths >= 3 ? "green"
    : input.emergencyFundMonths >= 2 ? "yellow"
    : "red";

  return [
    {
      id: "cash-on-hand",
      label: "Caja operativa",
      value: `$${formatCurrency(operationalCash)}`,
      secondary: `Reserva fiscal: $${formatCurrency(reserveDollars)} (${round1(TAX_RESERVE_RATE_ON_INCLUSIVE_TOTAL * 100)}%)`,
      semaphore: operationalCash > 0 ? "green" : "red",
      priority: "p0_critical",
      drillDownHref: "/admin/finance/cash-flow",
    },
    {
      id: "emergency-fund",
      label: "Fondo emergencia",
      value: `${round1(input.emergencyFundMonths)} meses`,
      semaphore: fundSemaphore,
      priority: fundSemaphore === "red" ? "p0_critical" : "p1_urgent",
      drillDownHref: "/admin/finance/reserves",
    },
  ];
}

function buildFinancialKpiMetrics(input: CommandCenterInput): CommandCenterMetric[] {
  return [
    {
      id: "contribution-margin",
      label: "Margen contribución",
      value: input.contributionMarginPercent !== null
        ? `${round1(input.contributionMarginPercent)}%`
        : "—",
      semaphore: semaphoreForMinThreshold(
        input.contributionMarginPercent,
        DASHBOARD_THRESHOLDS.contributionMarginPercent
      ),
      priority: "p1_urgent",
      drillDownHref: "/admin/finance/margins",
    },
    {
      id: "net-margin",
      label: "Margen neto real",
      value: input.netMarginPercent !== null
        ? `${round1(input.netMarginPercent)}%`
        : input.fixedCostsConfigured ? "—" : "Sin costos fijos",
      secondary: input.fixedCostPerServiceDollars !== null
        ? `Costo fijo: $${formatCurrency(input.fixedCostPerServiceDollars)}/servicio`
        : undefined,
      semaphore: semaphoreForMinThreshold(
        input.netMarginPercent,
        DASHBOARD_THRESHOLDS.netMarginPercent
      ),
      priority: "p1_urgent",
      drillDownHref: "/admin/finance/margins",
    },
    {
      id: "monthly-revenue",
      label: "Ingreso mes",
      value: `$${formatCurrency(input.monthlyRevenueCents / 100)}`,
      secondary: input.monthlyNetCents > 0
        ? `Neto: $${formatCurrency(input.monthlyNetCents / 100)}`
        : undefined,
      semaphore: "green",
      priority: "p1_urgent",
      drillDownHref: "/admin/finance/revenue",
    },
    {
      id: "dispute-free-rate",
      label: "Tasa sin disputas",
      value: input.disputeFreeRatePercent !== null
        ? `${round1(input.disputeFreeRatePercent)}%`
        : "—",
      semaphore: semaphoreForMinThreshold(
        input.disputeFreeRatePercent,
        DASHBOARD_THRESHOLDS.disputeFreeRatePercent
      ),
      priority: "p2_info",
      drillDownHref: "/admin/quality/disputes",
    },
    {
      id: "batch-capture",
      label: "Batch Capture",
      value: input.batchCaptureSuccessRatePercent !== null
        ? `${round1(input.batchCaptureSuccessRatePercent)}%`
        : "—",
      semaphore: semaphoreForMinThreshold(
        input.batchCaptureSuccessRatePercent,
        DASHBOARD_THRESHOLDS.batchCaptureSuccessRatePercent
      ),
      priority: "p2_info",
      drillDownHref: "/admin/payments/batch-capture",
    },
  ];
}

function buildQualityMetrics(input: CommandCenterInput): CommandCenterMetric[] {
  return [
    {
      id: "qc-score",
      label: "QC hoy",
      value: input.qcScoreToday !== null ? `${input.qcScoreToday}/100` : "—",
      semaphore:
        input.qcScoreToday !== null
          ? input.qcScoreToday >= 85 ? "green" : input.qcScoreToday >= 70 ? "yellow" : "red"
          : "unknown",
      priority: "p1_urgent",
      drillDownHref: "/admin/quality/qc-dashboard",
    },
    {
      id: "team-score",
      label: "Score equipos",
      value: input.teamScoreAverage !== null ? String(Math.round(input.teamScoreAverage)) : "—",
      semaphore: semaphoreForMinThreshold(
        input.teamScoreAverage,
        DASHBOARD_THRESHOLDS.teamScoreAverage
      ),
      priority: "p1_urgent",
      drillDownHref: "/admin/teams/scoring",
    },
    {
      id: "open-disputes",
      label: "Disputas abiertas",
      value: String(input.openDisputesCount),
      semaphore: input.openDisputesCount === 0 ? "green" : input.openDisputesCount <= 2 ? "yellow" : "red",
      priority: input.openDisputesCount > 0 ? "p0_critical" : "p2_info",
      drillDownHref: "/admin/quality/disputes",
    },
  ];
}

/**
 * Resumen rápido de los semáforos del sistema para el grupo "Sistema" del
 * Command Center. Las métricas completas con drill-down viven en
 * system-health-panel.ts — aquí solo van los colores para el vistazo rápido.
 */
function buildSystemHealthSummary(input: CommandCenterInput): CommandCenterMetric[] {
  return [
    {
      id: "dispatch-health",
      label: "Despacho",
      value: input.teamsInFieldCount > 0 ? "Activo" : "Inactivo",
      semaphore: "green",
      priority: "p2_info",
      drillDownHref: "/admin/system/health#despacho",
    },
    {
      id: "payment-sync",
      label: "Pagos (QBO)",
      value: input.fixedCostsConfigured ? "OK" : "Pendiente",
      semaphore: input.fixedCostsConfigured ? "green" : "yellow",
      priority: "p2_info",
      drillDownHref: "/admin/system/health#pagos",
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

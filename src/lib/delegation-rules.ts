/**
 * v8.3 G.5 — Reglas de Delegación Automática Configurables.
 *
 * El admin define reglas que enrutan alertas a la persona correcta sin pasar
 * por el dueño como cuello de botella:
 *
 *   "Alertas de inventario → Coordinador María (timeout 30 min)."
 *   "Disputas >$200 → Dueño (timeout 10 min)."
 *   "Safety Abort → Dueño + Coordinador Seguridad (timeout 2 min)."
 *
 * El sistema enruta automáticamente según estas reglas. El admin solo ve
 * las alertas que requieren su atención directa (las demás ya están delegadas
 * y tienen dueño visible en la bandeja unificada).
 *
 * Conecta:
 *   - autopilot-mode.ts  → modo operativo (manual: sugiere y espera; autopilot: ejecuta).
 *   - unified-alerts.ts  → bandeja unificada donde aterrizan las alertas enrutadas.
 *   - dispatch-fallback.ts → timer de 10 min para decisiones no respondidas.
 *
 * Diseño: funciones puras que evalúan reglas contra una alerta entrante y
 * devuelven la delegación resultante (quién debe atenderla y en cuánto
 * tiempo). La ejecución real (notificar a la persona, hacer escalation al
 * vencer el timeout) la hace la capa de infraestructura (route handlers,
 * cron jobs).
 */

import type { UnifiedAlertSeverity, UnifiedAlertTier } from "@/lib/unified-alerts";
import type { OperatingMode } from "@/lib/autopilot-mode";

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

/** Fuentes de alerta que pueden tener reglas de delegación. */
export type DelegationAlertSource =
  | "inventory"
  | "dispute"
  | "safety_abort"
  | "qc_failure"
  | "payment_failure"
  | "legal_feed_blind"
  | "pwa_heartbeat_missing"
  | "dispatch_pending"
  | "payroll_discrepancy"
  | "backup_overdue";

/** Rol o persona a quien se delega. */
export type DelegateTarget =
  | "owner"
  | "coordinator"
  | "safety_officer"
  | "accountant"
  | "dispatcher"
  | "hr_manager"
  | "legal_officer"
  | string; // permite nombres personalizados: "María", "Carlos Gómez"

/** Una regla de delegación configurada por el admin. */
export interface DelegationRule {
  /** Identificador único de la regla (para editarla/eliminarla). */
  id: string;
  /** Fuente de alerta que dispara esta regla. */
  source: DelegationAlertSource;
  /** Umbral opcional: la regla solo aplica si el monto de la disputa/fallo supera este valor en cents. */
  minAmountCents?: number;
  /** Severidad mínima: la regla solo aplica si la alerta tiene esta severidad o superior. */
  minSeverity?: UnifiedAlertSeverity;
  /** A quién se delega. */
  delegateTo: DelegateTarget;
  /** Tiempo máximo (minutos) antes de escalar si no hay respuesta. */
  timeoutMinutes: number;
  /** Prioridad de la regla: si dos reglas matchean, gana la de menor número. */
  priority: number;
  /** true si la regla está activa. */
  enabled: boolean;
  /** Descripción legible para el admin. */
  description: string;
}

/** Resultado de evaluar las reglas contra una alerta entrante. */
export interface DelegationResult {
  /** Alerta fue delegada exitosamente a alguien. */
  delegated: boolean;
  /** A quién se delegó (null si ninguna regla aplicó). */
  target: DelegateTarget | null;
  /** Timeout en minutos antes de escalar. */
  timeoutMinutes: number;
  /** ID de la regla que aplicó (para trazabilidad). */
  matchedRuleId: string | null;
  /** Razón si no se delegó. */
  reason?: string;
  /** Texto para mostrar en la bandeja: "Asignado a María (timeout 30 min)". */
  displayText: string;
}

/** Conjunto completo de reglas de delegación, con utilidades de búsqueda. */
export interface DelegationRuleSet {
  rules: DelegationRule[];
  /** Timestamp de última modificación. */
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reglas predefinidas (factory defaults)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Conjunto de reglas de delegación por defecto que el admin puede
 * personalizar. Basadas en G.5: "Alertas de inventario → Coordinador
 * María (timeout 30 min). Disputas >$200 → Dueño (timeout 10 min)."
 */
export function buildDefaultDelegationRules(): DelegationRule[] {
  return [
    {
      id: "default-safety",
      source: "safety_abort",
      delegateTo: "owner",
      timeoutMinutes: 2,
      priority: 1,
      enabled: true,
      description: "Safety Abort: el dueño debe responder en 2 minutos. Si no, escala a contacto de emergencia.",
    },
    {
      id: "default-pwa-heartbeat",
      source: "pwa_heartbeat_missing",
      delegateTo: "safety_officer",
      timeoutMinutes: 5,
      priority: 2,
      enabled: true,
      description: "Heartbeat perdido >15 min: el oficial de seguridad verifica bienestar del empleado.",
    },
    {
      id: "default-dispute-high",
      source: "dispute",
      minAmountCents: 200_00, // $200
      delegateTo: "owner",
      timeoutMinutes: 10,
      priority: 3,
      enabled: true,
      description: "Disputas >$200: solo el dueño las maneja. Timeout 10 min.",
    },
    {
      id: "default-dispute-low",
      source: "dispute",
      delegateTo: "coordinator",
      timeoutMinutes: 30,
      priority: 4,
      enabled: true,
      description: "Disputas ≤$200: el coordinador las resuelve. Timeout 30 min.",
    },
    {
      id: "default-inventory",
      source: "inventory",
      delegateTo: "coordinator",
      timeoutMinutes: 30,
      priority: 5,
      enabled: true,
      description: "Alertas de inventario: el coordinador gestiona la reposición. Timeout 30 min.",
    },
    {
      id: "default-qc-failure",
      source: "qc_failure",
      delegateTo: "coordinator",
      timeoutMinutes: 60,
      priority: 6,
      enabled: true,
      description: "Fallo de QC: el coordinador revisa y dispara plan correctivo si aplica.",
    },
    {
      id: "default-payment-failure",
      source: "payment_failure",
      delegateTo: "accountant",
      timeoutMinutes: 120,
      priority: 7,
      enabled: true,
      description: "Fallo de pago recurrente: el contador contacta al cliente. Timeout 2h.",
    },
    {
      id: "default-legal-blind",
      source: "legal_feed_blind",
      delegateTo: "legal_officer",
      timeoutMinutes: 240,
      priority: 8,
      enabled: true,
      description: "Feed legal ciego >30 días: el oficial legal revisa y actualiza.",
    },
    {
      id: "default-dispatch-pending",
      source: "dispatch_pending",
      delegateTo: "dispatcher",
      timeoutMinutes: 15,
      priority: 9,
      enabled: true,
      description: "Órdenes sin asignar: el despachador resuelve o escala al dueño. Timeout 15 min.",
    },
    {
      id: "default-payroll-discrepancy",
      source: "payroll_discrepancy",
      delegateTo: "hr_manager",
      timeoutMinutes: 120,
      priority: 10,
      enabled: true,
      description: "Discrepancia de nómina: RRHH revisa horas vs day rates. Timeout 2h.",
    },
    {
      id: "default-backup-overdue",
      source: "backup_overdue",
      delegateTo: "coordinator",
      timeoutMinutes: 240,
      priority: 11,
      enabled: true,
      description: "Backup atrasado: el coordinador verifica y ejecuta el backup pendiente.",
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Labels amigables
// ═══════════════════════════════════════════════════════════════════════════

export const DELEGATE_TARGET_LABELS: Record<string, string> = {
  owner: "Dueño",
  coordinator: "Coordinador",
  safety_officer: "Oficial de Seguridad",
  accountant: "Contador",
  dispatcher: "Despachador",
  hr_manager: "RRHH",
  legal_officer: "Oficial Legal",
};

export const DELEGATION_SOURCE_LABELS: Record<DelegationAlertSource, string> = {
  inventory: "Inventario bajo",
  dispute: "Disputa",
  safety_abort: "Safety Abort",
  qc_failure: "Fallo QC",
  payment_failure: "Fallo de pago",
  legal_feed_blind: "Feed legal ciego",
  pwa_heartbeat_missing: "Heartbeat perdido",
  dispatch_pending: "Despacho pendiente",
  payroll_discrepancy: "Discrepancia nómina",
  backup_overdue: "Backup atrasado",
};

// ═══════════════════════════════════════════════════════════════════════════
// Evaluación de reglas contra una alerta
// ═══════════════════════════════════════════════════════════════════════════

export interface DelegationAlertInput {
  source: DelegationAlertSource;
  severity: UnifiedAlertSeverity;
  tier: UnifiedAlertTier;
  /** Monto involucrado en cents (para disputas, fallos de pago, etc.). */
  amountCents?: number;
}

/**
 * Evalúa el conjunto de reglas contra una alerta entrante y devuelve la
 * delegación resultante.
 *
 * Las reglas se evalúan en orden de prioridad (menor número = mayor
 * prioridad). La primera regla que matchea gana. Si ninguna matchea, la
 * alerta va a la bandeja del dueño por defecto.
 *
 * @param ruleSet — reglas configuradas por el admin.
 * @param alert — alerta entrante a enrutar.
 * @param operatingMode — modo operativo actual (afecta si se delega o se sugiere).
 */
export function evaluateDelegation(
  ruleSet: DelegationRuleSet,
  alert: DelegationAlertInput,
  operatingMode: OperatingMode
): DelegationResult {
  const enabledRules = ruleSet.rules
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of enabledRules) {
    if (!ruleMatches(rule, alert)) continue;

    const displayText = buildDisplayText(rule, operatingMode);

    return {
      delegated: true,
      target: rule.delegateTo,
      timeoutMinutes: rule.timeoutMinutes,
      matchedRuleId: rule.id,
      displayText,
    };
  }

  // Fallback: si ninguna regla matchea, la alerta va al dueño con timeout
  // por defecto según el tier (respond_10min → 10 min, can_wait → 60 min).
  const defaultTimeout = alert.tier === "respond_10min" ? 10 : 60;

  return {
    delegated: false,
    target: "owner",
    timeoutMinutes: defaultTimeout,
    matchedRuleId: null,
    reason: `Sin regla de delegación para alertas de tipo "${alert.source}" con severidad "${alert.severity}". Asignado al dueño por defecto.`,
    displayText: `Sin regla — asignado al Dueño (timeout ${defaultTimeout} min)`,
  };
}

function ruleMatches(rule: DelegationRule, alert: DelegationAlertInput): boolean {
  if (rule.source !== alert.source) return false;

  // Verificar umbral de monto
  if (rule.minAmountCents !== undefined) {
    const alertAmount = alert.amountCents ?? 0;
    if (alertAmount < rule.minAmountCents) return false;
  }

  // Verificar severidad mínima
  if (rule.minSeverity !== undefined) {
    const severityRank: Record<UnifiedAlertSeverity, number> = {
      p0_safety: 0,
      p1_urgent: 1,
      p2_automatic: 2,
    };
    if (severityRank[alert.severity] > severityRank[rule.minSeverity]) return false;
  }

  return true;
}

function buildDisplayText(rule: DelegationRule, operatingMode: OperatingMode): string {
  const targetLabel = DELEGATE_TARGET_LABELS[rule.delegateTo] ?? rule.delegateTo;
  const prefix = operatingMode === "autopilot" ? "Asignado a" : "Sugerido para";
  return `${prefix} ${targetLabel} (timeout ${rule.timeoutMinutes} min)`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilidades para el admin: CRUD de reglas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valida una regla de delegación antes de guardarla.
 * Devuelve los errores encontrados (vacío = regla válida).
 */
export function validateDelegationRule(rule: DelegationRule): string[] {
  const errors: string[] = [];

  if (!rule.id || rule.id.trim().length === 0) {
    errors.push("El ID de la regla es requerido.");
  }
  if (!rule.source) {
    errors.push("La fuente de alerta (source) es requerida.");
  }
  if (!rule.delegateTo || rule.delegateTo.trim().length === 0) {
    errors.push("El destinatario (delegateTo) es requerido.");
  }
  if (rule.timeoutMinutes < 1) {
    errors.push("El timeout debe ser al menos 1 minuto.");
  }
  if (rule.timeoutMinutes > 1440) {
    errors.push("El timeout no puede exceder 24 horas (1440 min).");
  }
  if (rule.priority < 1) {
    errors.push("La prioridad debe ser >= 1.");
  }

  // Validar que minAmountCents sea positivo si está presente
  if (rule.minAmountCents !== undefined && rule.minAmountCents < 0) {
    errors.push("minAmountCents no puede ser negativo.");
  }

  return errors;
}

/**
 * Añade o reemplaza una regla en el conjunto. Si el ID ya existe, la
 * reemplaza; si no, la añade al final.
 */
export function upsertDelegationRule(
  ruleSet: DelegationRuleSet,
  rule: DelegationRule,
  nowIso: string
): DelegationRuleSet {
  const idx = ruleSet.rules.findIndex((r) => r.id === rule.id);
  const newRules =
    idx >= 0
      ? [...ruleSet.rules.slice(0, idx), rule, ...ruleSet.rules.slice(idx + 1)]
      : [...ruleSet.rules, rule];

  // Recalcular prioridades para mantener consistencia si se insertó al final
  // (las reglas existentes mantienen su prioridad)

  return {
    rules: newRules,
    updatedAt: nowIso,
  };
}

/**
 * Elimina una regla por ID.
 */
export function removeDelegationRule(
  ruleSet: DelegationRuleSet,
  ruleId: string,
  nowIso: string
): DelegationRuleSet {
  return {
    rules: ruleSet.rules.filter((r) => r.id !== ruleId),
    updatedAt: nowIso,
  };
}

/**
 * Activa o desactiva una regla existente.
 */
export function toggleDelegationRule(
  ruleSet: DelegationRuleSet,
  ruleId: string,
  enabled: boolean,
  nowIso: string
): DelegationRuleSet {
  return {
    rules: ruleSet.rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)),
    updatedAt: nowIso,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Vista consolidada: ¿qué alertas van a quién?
// ═══════════════════════════════════════════════════════════════════════════

export interface DelegateWorkload {
  target: DelegateTarget;
  targetLabel: string;
  /** Reglas que apuntan a esta persona. */
  rules: DelegationRule[];
  /** Alertas actualmente asignadas (cantidad). */
  activeAlertCount: number;
}

/**
 * Agrupa las reglas por destinatario para que el admin vea la carga de
 * trabajo delegada a cada rol/persona.
 */
export function summarizeDelegationWorkload(
  ruleSet: DelegationRuleSet,
  activeAlertCounts: Partial<Record<DelegationAlertSource, number>>
): DelegateWorkload[] {
  const map = new Map<DelegateTarget, DelegationRule[]>();

  for (const rule of ruleSet.rules) {
    if (!rule.enabled) continue;
    const existing = map.get(rule.delegateTo) ?? [];
    existing.push(rule);
    map.set(rule.delegateTo, existing);
  }

  return Array.from(map.entries())
    .map(([target, rules]) => {
      const alertCount = rules.reduce((sum, r) => sum + (activeAlertCounts[r.source] ?? 0), 0);
      return {
        target,
        targetLabel: DELEGATE_TARGET_LABELS[target] ?? target,
        rules,
        activeAlertCount: alertCount,
      };
    })
    .sort((a, b) => b.activeAlertCount - a.activeAlertCount);
}

// ═══════════════════════════════════════════════════════════════════════════
// Integración con unified-alerts: enriquecer alerta con delegación
// ═══════════════════════════════════════════════════════════════════════════

export interface EnrichedAlert {
  /** Datos originales de la alerta unificada. */
  alertId: string;
  source: DelegationAlertSource;
  severity: UnifiedAlertSeverity;
  tier: UnifiedAlertTier;
  title: string;
  summary: string | null;
  /** Resultado de la delegación. */
  delegation: DelegationResult;
}

/**
 * Enriquece una alerta de la bandeja unificada con su información de
 * delegación. El frontend usa `delegation.displayText` para mostrar
 * "Asignado a María (timeout 30 min)" junto a la alerta.
 */
export function enrichAlertWithDelegation(
  alertId: string,
  source: DelegationAlertSource,
  severity: UnifiedAlertSeverity,
  tier: UnifiedAlertTier,
  title: string,
  summary: string | null,
  amountCents: number | undefined,
  ruleSet: DelegationRuleSet,
  operatingMode: OperatingMode
): EnrichedAlert {
  const delegation = evaluateDelegation(
    ruleSet,
    { source, severity, tier, amountCents },
    operatingMode
  );

  return {
    alertId,
    source,
    severity,
    tier,
    title,
    summary,
    delegation,
  };
}

/**
 * Motor de reglas headless (Fase 1.3 del documento maestro).
 *
 * Las reglas se definen de forma declarativa en JSON y se evalúan
 * siempre en el servidor. El cliente nunca aplica reglas.
 */

export interface RuleCondition {
  field: string;
  op: "==" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not_in" | "contains";
  value: unknown;
}

export interface PricingRule {
  id: string;
  name: string;
  description?: string;
  conditionJson: { and?: RuleCondition[]; or?: RuleCondition[] } | RuleCondition;
  actionType: "price_multiplier" | "price_add" | "price_set" | "block" | "flag_for_review";
  actionValue?: number;
  priority: number;
  maxApplicable: boolean;
  isActive: boolean;
}

export interface RuleContext {
  zone: string;
  dayOfWeek: number;
  isPreferredDay: boolean;
  serviceType: string;
  serviceSubtype: string;
  squareFeet: number;
  clientScore: number;
  servicesCount: number;
  disputesLostCount: number;
  accountType: string;
  /** Tipo de cliente derivado: new | returning | elite */
  clientType: "new" | "returning" | "elite";
  /** Demanda estimada de la zona (0-100). */
  zoneDemand: number;
  /** Carga orgánica derivada: low | medium | high */
  organicLoad: "low" | "medium" | "high";
  /** Días desde última limpieza profesional (recencia). */
  daysSinceCleaning: number;
  /** Días de antelación de la reserva. */
  advanceNoticeDays: number;
  [key: string]: unknown;
}

export interface AppliedRule {
  ruleId: string;
  name: string;
  actionType: PricingRule["actionType"];
  actionValue?: number;
  adjustment: number;
}

export interface RuleApplicationResult {
  adjustment: number; // en dólares; para multiplicador se aplica sobre el subtotal
  appliedRules: AppliedRule[];
  blocked: boolean;
  blockReason?: string;
  flagged: boolean;
  flagReason?: string;
}

export interface SimulationCase {
  name: string;
  context: RuleContext;
  basePrice: number;
  subtotal: number;
}

export interface SimulationResult {
  name: string;
  result: RuleApplicationResult;
  finalSubtotal: number;
}

function evaluateSingleCondition(condition: RuleCondition, context: RuleContext): boolean {
  const ctxValue = context[condition.field];
  const ruleValue = condition.value;

  switch (condition.op) {
    case "==":
      return ctxValue === ruleValue;
    case "!=":
      return ctxValue !== ruleValue;
    case ">":
      return typeof ctxValue === "number" && typeof ruleValue === "number" && ctxValue > ruleValue;
    case ">=":
      return typeof ctxValue === "number" && typeof ruleValue === "number" && ctxValue >= ruleValue;
    case "<":
      return typeof ctxValue === "number" && typeof ruleValue === "number" && ctxValue < ruleValue;
    case "<=":
      return typeof ctxValue === "number" && typeof ruleValue === "number" && ctxValue <= ruleValue;
    case "in":
      return Array.isArray(ruleValue) && ruleValue.includes(ctxValue);
    case "not_in":
      return Array.isArray(ruleValue) && !ruleValue.includes(ctxValue);
    case "contains":
      return (
        typeof ctxValue === "string" &&
        typeof ruleValue === "string" &&
        ctxValue.toLowerCase().includes(ruleValue.toLowerCase())
      );
    default:
      return false;
  }
}

function evaluateCondition(
  condition: RuleCondition | { and?: RuleCondition[]; or?: RuleCondition[] },
  context: RuleContext
): boolean {
  if ("field" in condition) {
    return evaluateSingleCondition(condition as RuleCondition, context);
  }

  const group = condition as { and?: RuleCondition[]; or?: RuleCondition[] };
  if (group.and && group.and.length > 0) {
    return group.and.every((c) => evaluateCondition(c, context));
  }
  if (group.or && group.or.length > 0) {
    return group.or.some((c) => evaluateCondition(c, context));
  }
  return false;
}

export const MAX_CUMULATIVE_SURCHARGE_PERCENT = 0.25; // +25% sobre el subtotal

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
}

export function applyPricingRules(
  rules: PricingRule[],
  context: RuleContext,
  basePrice: number,
  subtotal: number
): RuleApplicationResult {
  const result: RuleApplicationResult = {
    adjustment: 0,
    appliedRules: [],
    blocked: false,
    flagged: false,
  };

  // Ordenar por prioridad descendente; las de bloqueo primero
  const sorted = [...rules]
    .filter((r) => r.isActive)
    .sort((a, b) => {
      if (a.actionType === "block" && b.actionType !== "block") return -1;
      if (a.actionType !== "block" && b.actionType === "block") return 1;
      return b.priority - a.priority;
    });

  let hasMultiplier = false;
  let multiplier = 1;
  const maxSurcharge = Math.round(subtotal * MAX_CUMULATIVE_SURCHARGE_PERCENT);

  for (const rule of sorted) {
    const matches = evaluateCondition(rule.conditionJson, context);
    if (!matches) continue;

    if (rule.actionType === "block") {
      result.blocked = true;
      result.blockReason = rule.description || `Blocked by rule: ${rule.name}`;
      return result;
    }

    if (rule.actionType === "flag_for_review") {
      result.flagged = true;
      result.flagReason = rule.description || `Flagged by rule: ${rule.name}`;
      continue;
    }

    let adjustment = 0;
    if (rule.actionType === "price_add") {
      adjustment = rule.actionValue ?? 0;
    } else if (rule.actionType === "price_multiplier") {
      // Los multiplicadores no son acumulables entre sí; se toma el más prioritario
      if (hasMultiplier) continue;
      multiplier = rule.actionValue ?? 1;
      adjustment = Math.round(subtotal * (multiplier - 1));
      hasMultiplier = true;
    } else if (rule.actionType === "price_set") {
      adjustment = (rule.actionValue ?? basePrice) - subtotal;
    }

    // Piso de impacto acumulado: nunca más de +25% sobre el subtotal.
    // Si una regla haría superar el tope, se descarta por completo.
    if (result.adjustment + adjustment > maxSurcharge) {
      result.flagged = true;
      result.flagReason = (
        (result.flagReason ? `${result.flagReason}; ` : "") +
        `Rule "${rule.name}" discarded: would exceed +25% cumulative surcharge cap (${formatCurrency(maxSurcharge)}).`
      );
      continue;
    }

    result.adjustment += adjustment;
    result.appliedRules.push({
      ruleId: rule.id,
      name: rule.name,
      actionType: rule.actionType,
      actionValue: rule.actionValue,
      adjustment,
    });

    if (!rule.maxApplicable) break;
  }

  return result;
}

/**
 * Detecta conflictos simples entre reglas activas:
 * - Dos reglas con el mismo campo/condición y acción contradictoria.
 * No es un solver completo, pero evita errores obvios.
 */
export function detectRuleConflicts(rules: PricingRule[]): string[] {
  const conflicts: string[] = [];
  const byField = new Map<string, PricingRule[]>();

  for (const rule of rules.filter((r) => r.isActive)) {
    const fields = extractFields(rule.conditionJson);
    for (const field of fields) {
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field)!.push(rule);
    }
  }

  byField.forEach((group) => {
    if (group.length > 1) {
      const blockers = group.filter((r: PricingRule) => r.actionType === "block");
      const nonBlockers = group.filter((r: PricingRule) => r.actionType !== "block");
      if (blockers.length > 0 && nonBlockers.length > 0) {
        conflicts.push(
          `Rule "${blockers[0].name}" blocks while rules [${nonBlockers
            .map((r: PricingRule) => `"${r.name}"`)
            .join(", ")}] may apply to the same context.`
        );
      }
    }
  });

  return conflicts;
}

/**
 * v8.3 E1-C7 — Prevención de CIRCULARIDAD.
 * Una regla es circular si su condición depende de un campo derivado del
 * precio (subtotal, total, price...) Y su acción a la vez modifica el precio:
 * el resultado de aplicarla cambia su propia condición (feedback infinito
 * conceptual). El motor aplica reglas una sola vez, pero una regla así es un
 * error de diseño del admin y debe rechazarse al GUARDAR.
 */
const PRICE_DERIVED_FIELDS = new Set([
  "subtotal",
  "total",
  "price",
  "base_price",
  "basePrice",
  "final_price",
  "finalPrice",
  "margin",
  "margin_contribution",
  "marginContribution",
]);

const PRICE_MODIFYING_ACTIONS = new Set<PricingRule["actionType"]>([
  "price_multiplier",
  "price_add",
  "price_set",
]);

export function detectCircularRules(rules: PricingRule[]): string[] {
  const errors: string[] = [];
  for (const rule of rules.filter((r) => r.isActive)) {
    if (!PRICE_MODIFYING_ACTIONS.has(rule.actionType)) continue;
    const fields = extractFields(rule.conditionJson);
    const circularFields = fields.filter((f) => PRICE_DERIVED_FIELDS.has(f));
    if (circularFields.length > 0) {
      errors.push(
        `Rule "${rule.name}" is CIRCULAR: its condition depends on price-derived field(s) [${circularFields.join(
          ", "
        )}] while its action modifies the price. Rejected (v8.3 E1-C7).`
      );
    }
  }
  return errors;
}

function extractFields(
  condition: RuleCondition | { and?: RuleCondition[]; or?: RuleCondition[] }
): string[] {
  if ("field" in condition) {
    return [(condition as RuleCondition).field];
  }
  const group = condition as { and?: RuleCondition[]; or?: RuleCondition[] };
  const fields: string[] = [];
  for (const list of [group.and || [], group.or || []]) {
    for (const c of list) {
      if (c) {
        fields.push(...extractFields(c));
      }
    }
  }
  return Array.from(new Set(fields));
}

/**
 * Sandbox de simulación A/B: ejecuta un conjunto de reglas sobre múltiples
 * casos de prueba sin persistir nada. Permite comparar escenarios antes de
 * activar reglas en producción.
 */
export function simulatePricingRules(
  rules: PricingRule[],
  cases: SimulationCase[]
): SimulationResult[] {
  return cases.map((c) => {
    const result = applyPricingRules(rules, c.context, c.basePrice, c.subtotal);
    return {
      name: c.name,
      result,
      finalSubtotal: Math.max(0, c.subtotal + result.adjustment),
    };
  });
}

/**
 * Divide clientes en grupos A/B/C (por defecto 80/10/10) usando un hash
 * estable del user_id. Base para experimentos de precios.
 */
export function getABTestBucket(userId: string, buckets: number[] = [80, 10, 10]): "A" | "B" | "C" {
  if (buckets.length !== 3 || buckets.reduce((a, b) => a + b, 0) !== 100) {
    throw new Error("AB test buckets must be three numbers that sum to 100");
  }
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  const normalized = Math.abs(hash) % 100;
  if (normalized < buckets[0]) return "A";
  if (normalized < buckets[0] + buckets[1]) return "B";
  return "C";
}

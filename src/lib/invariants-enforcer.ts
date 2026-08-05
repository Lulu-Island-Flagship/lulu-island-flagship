/**
 * v8.3 B.2.26-B.2.33 — Enforcer de los 8 invariantes ampliados.
 *
 * Cada invariante es una función pura que retorna {passed: boolean, reason?: string}.
 * El enforcer es consumido por middleware (Next.js edge) y edge functions (Supabase)
 * para validar que cada operación crítica respete las reglas de negocio invariantes.
 *
 * Los 8 invariantes:
 *
 *   B.2.26 — Inventory-Dispatch Gate:
 *     Antes de asignar equipo a un servicio, el stock debe cubrir el consumo
 *     SOP proyectado + 20% buffer. Conecta: inventory-dispatch-gate.ts.
 *
 *   B.2.27 — Canal Telefónico Parity:
 *     El canal telefónico debe tener las mismas capacidades de booking que
 *     el web. No debe existir un "feature gap" entre canales.
 *     Conecta: telephony-router.ts.
 *
 *   B.2.28 — Fallback Progresivo:
 *     Toda decisión que espera al admin tiene timer de 10 minutos. Al vencer,
 *     el sistema decide con reglas pre-aprobadas y loguea.
 *     Conecta: dispatch-fallback.ts.
 *
 *   B.2.29 — Gate Financiero:
 *     No se despacha un servicio sin hold de pago confirmado. El hold debe
 *     existir y ser válido antes de que el equipo salga a campo.
 *     Conecta: payment-capture-reconciliation.ts.
 *
 *   B.2.30 — Carga Biomecánica:
 *     La carga biomecánica del empleado no debe exceder el máximo de 72h.
 *     Hard-block: si excede, el empleado no puede ser asignado.
 *     Conecta: biomechanical-index.ts.
 *
 *   B.2.31 — Bloqueo de Campañas:
 *     Las campañas de marketing deben verificar suficiencia de inventario
 *     (ventana de 14 días) antes de activarse.
 *     Conecta: campaign-inventory-lock.ts.
 *
 *   B.2.32 — Gracia Recurrente:
 *     Un fallo de pago NO cancela el servicio. Activa período de gracia de
 *     15 días. El servicio se completa, el saldo va al Shadow Ledger.
 *     Conecta: grace-period.ts (v8.3 C.10/G.6).
 *
 *   B.2.33 — Anti-Gaming:
 *     Detección de fricción del cliente (tickets/servicios > 25%) y muestreo
 *     determinístico de QC (10% de auto-aprobaciones a revisión humana).
 *     Conecta: client-friction-score.ts (v8.3 C.9/G.3) + anti-gaming.ts.
 *
 * Cada invariante es una función pura — no accede a base de datos, no
 * tiene efectos secundarios. Los datos los provee el caller.
 *
 * @module invariants-enforcer
 */

import { z } from "zod";
import { logEvent } from "@/lib/observability";

// ── Tipos comunes ────────────────────────────────────────────────────────────

/** Resultado de la validación de un invariante. */
export interface InvariantResult {
  /** true si el invariante se cumple. */
  passed: boolean;
  /** Razón del resultado (siempre presente, para auditoría). */
  reason: string;
}

/** Identificador de cada invariante. */
export type InvariantId =
  | "B.2.26_inventory_dispatch_gate"
  | "B.2.27_canal_telefonico_parity"
  | "B.2.28_fallback_progresivo"
  | "B.2.29_gate_financiero"
  | "B.2.30_carga_biomecanica"
  | "B.2.31_bloqueo_campanas"
  | "B.2.32_gracia_recurrente"
  | "B.2.33_anti_gaming";

export const INVARIANT_IDS: InvariantId[] = [
  "B.2.26_inventory_dispatch_gate",
  "B.2.27_canal_telefonico_parity",
  "B.2.28_fallback_progresivo",
  "B.2.29_gate_financiero",
  "B.2.30_carga_biomecanica",
  "B.2.31_bloqueo_campanas",
  "B.2.32_gracia_recurrente",
  "B.2.33_anti_gaming",
];

/** Resultado agregado de la evaluación de todos los invariantes. */
export interface InvariantsEnforcementResult {
  /** Timestamp ISO8601 de la evaluación. */
  evaluatedAtIso: string;
  /** Resultado por invariante. */
  results: Record<InvariantId, InvariantResult>;
  /** Todos pasaron. */
  allPassed: boolean;
  /** Lista de invariantes que fallaron. */
  failed: InvariantId[];
  /** Lista de invariantes que pasaron. */
  passed: InvariantId[];
}

// ── B.2.26 — Inventory-Dispatch Gate ─────────────────────────────────────────

/** Input para el invariante de inventario-despacho. */
export const InventoryDispatchGateInputSchema = z.object({
  /** Total de items evaluados para el despacho. */
  totalItems: z.number().int().min(0)
    .describe("Total de items de inventario evaluados"),
  /** Items que no pasaron la verificación (stock insuficiente). */
  insuficientesCount: z.number().int().min(0)
    .describe("Cantidad de items con stock insuficiente"),
  /** ¿El gate de despacho fue aprobado? (de inventory-dispatch-gate.ts). */
  dispatchApproved: z.boolean()
    .describe("Resultado del gate inventory-dispatch"),
});

/**
 * B.2.26: El stock de inventario debe cubrir el consumo SOP proyectado
 * más un buffer del 20% antes de asignar equipo a un servicio.
 *
 * @returns InvariantResult: passed=false si hay items insuficientes.
 */
export function enforceInventoryDispatchGate(
  input: z.infer<typeof InventoryDispatchGateInputSchema>
): InvariantResult {
  const v = InventoryDispatchGateInputSchema.parse(input);
  if (!v.dispatchApproved) {
    return {
      passed: false,
      reason: `Inventory-Dispatch Gate: ${v.insuficientesCount} de ${v.totalItems} items con stock insuficiente. No se puede asignar equipo.`,
    };
  }
  if (v.totalItems === 0) {
    return { passed: true, reason: "Inventory-Dispatch Gate: sin items que verificar, pasa por defecto." };
  }
  return {
    passed: true,
    reason: `Inventory-Dispatch Gate: ${v.totalItems} items verificados, stock suficiente.`,
  };
}

// ── B.2.27 — Canal Telefónico Parity ─────────────────────────────────────────

/** Capacidades disponibles en un canal (web o telefónico). */
export interface ChannelCapabilities {
  canBook: boolean;
  canCancel: boolean;
  canReschedule: boolean;
  canViewPricing: boolean;
  canApplyPromoCode: boolean;
  canSelectTeam: boolean;
  canAddSpecialInstructions: boolean;
}

/** Input para el invariante de parity de canal telefónico. */
export const TelephonyParityInputSchema = z.object({
  web: z.object({
    canBook: z.boolean(),
    canCancel: z.boolean(),
    canReschedule: z.boolean(),
    canViewPricing: z.boolean(),
    canApplyPromoCode: z.boolean(),
    canSelectTeam: z.boolean(),
    canAddSpecialInstructions: z.boolean(),
  }).describe("Capacidades del canal web"),
  telephony: z.object({
    canBook: z.boolean(),
    canCancel: z.boolean(),
    canReschedule: z.boolean(),
    canViewPricing: z.boolean(),
    canApplyPromoCode: z.boolean(),
    canSelectTeam: z.boolean(),
    canAddSpecialInstructions: z.boolean(),
  }).describe("Capacidades del canal telefónico"),
});

/**
 * B.2.27: El canal telefónico debe tener las mismas capacidades de booking
 * que el canal web. No puede haber "feature gap" entre canales.
 *
 * @returns InvariantResult: passed=false si el canal telefónico carece de
 *   alguna capacidad que el web sí tiene.
 */
export function enforceTelephonyParity(
  input: z.infer<typeof TelephonyParityInputSchema>
): InvariantResult {
  const v = TelephonyParityInputSchema.parse(input);
  const gaps: string[] = [];
  const keys: (keyof ChannelCapabilities)[] = [
    "canBook", "canCancel", "canReschedule", "canViewPricing",
    "canApplyPromoCode", "canSelectTeam", "canAddSpecialInstructions",
  ];

  for (const key of keys) {
    if (v.web[key] && !v.telephony[key]) {
      gaps.push(key);
    }
  }

  if (gaps.length > 0) {
    return {
      passed: false,
      reason: `Canal Telefónico Parity: ${gaps.length} feature gap(s) detectado(s): ${gaps.join(", ")}. El canal telefónico carece de capacidades que el web tiene.`,
    };
  }

  return {
    passed: true,
    reason: "Canal Telefónico Parity: todas las capacidades del web están disponibles en el canal telefónico.",
  };
}

// ── B.2.28 — Fallback Progresivo ─────────────────────────────────────────────

/** Input para el invariante de fallback progresivo. */
export const ProgressiveFallbackInputSchema = z.object({
  /** Timestamp ISO8601 en que se detectó la discrepancia. */
  detectedAtIso: z.string().datetime({ offset: true })
    .describe("Timestamp cuando se detectó la discrepancia"),
  /** Timestamp ISO8601 actual o de referencia. */
  referenceIso: z.string().datetime({ offset: true })
    .describe("Timestamp de referencia para evaluar el timer"),
  /** Si el admin ya respondió (anula el timer). */
  adminResponded: z.boolean()
    .describe("true si el admin ya tomó una decisión"),
  /** Minutos del timer de fallback (default 10). */
  timerMinutes: z.number().int().min(1).default(10)
    .describe("Duración del timer de fallback en minutos"),
});

/**
 * B.2.28: Toda decisión que espera al admin tiene un timer de 10 minutos.
 * Al vencer, el sistema debe decidir con reglas pre-aprobadas y loguear.
 *
 * Este invariante NO decide — solo verifica que el timer se respetó.
 * passed=false significa que el timer venció y el sistema aún no aplicó
 * la regla pre-aprobada (el caller debe activar el fallback).
 *
 * @returns InvariantResult: passed=false si el timer venció sin respuesta del admin.
 */
export function enforceProgressiveFallback(
  input: z.infer<typeof ProgressiveFallbackInputSchema>
): InvariantResult {
  const v = ProgressiveFallbackInputSchema.parse(input);

  if (v.adminResponded) {
    return {
      passed: true,
      reason: "Fallback Progresivo: admin respondió antes del vencimiento del timer.",
    };
  }

  const detectedMs = new Date(v.detectedAtIso).getTime();
  const referenceMs = new Date(v.referenceIso).getTime();
  const elapsedMinutes = (referenceMs - detectedMs) / (1000 * 60);

  if (elapsedMinutes >= v.timerMinutes) {
    return {
      passed: false,
      reason: `Fallback Progresivo: timer de ${v.timerMinutes} min venció (${Math.floor(elapsedMinutes)} min transcurridos sin respuesta del admin). Se requiere activar regla pre-aprobada.`,
    };
  }

  return {
    passed: true,
    reason: `Fallback Progresivo: timer de ${v.timerMinutes} min no ha vencido (${Math.floor(elapsedMinutes)} min transcurridos).`,
  };
}

// ── B.2.29 — Gate Financiero ─────────────────────────────────────────────────

/** Estados posibles de un hold de pago. */
export type PaymentHoldStatus =
  | "hold_active"       // Hold autorizado y vigente
  | "hold_expired"      // Hold expiró (7 días Stripe)
  | "hold_captured"     // Hold ya fue capturado
  | "hold_cancelled"    // Hold fue cancelado
  | "no_hold";          // No existe hold

/** Input para el invariante de gate financiero. */
export const FinancialGateInputSchema = z.object({
  /** Estado del hold de pago asociado a la orden. */
  holdStatus: z.enum(["hold_active", "hold_expired", "hold_captured", "hold_cancelled", "no_hold"])
    .describe("Estado actual del hold de pago"),
  /** Monto del hold en centavos. */
  holdAmountCents: z.number().int().min(0)
    .describe("Monto del hold de pago en centavos"),
  /** Monto mínimo requerido para el servicio (centavos). */
  requiredAmountCents: z.number().int().min(0)
    .describe("Monto mínimo requerido para cubrir el servicio"),
  /** Si es un cliente con crédito aprobado (bypasea el hold). */
  hasApprovedCredit: z.boolean().default(false)
    .describe("true si el cliente tiene línea de crédito aprobada"),
});

/**
 * B.2.29: No se despacha un servicio sin un hold de pago confirmado.
 * El hold debe existir, estar activo y cubrir el monto requerido.
 *
 * Excepción: clientes con crédito aprobado (límite documentado en
 * credit_limits, no se verifica aquí porque es responsabilidad del
 * caller pre-verificar el límite disponible).
 *
 * @returns InvariantResult: passed=false si no hay hold válido y no hay crédito aprobado.
 */
export function enforceFinancialGate(
  input: z.infer<typeof FinancialGateInputSchema>
): InvariantResult {
  const v = FinancialGateInputSchema.parse(input);

  if (v.hasApprovedCredit) {
    return {
      passed: true,
      reason: "Gate Financiero: cliente con crédito aprobado — hold no requerido.",
    };
  }

  if (v.holdStatus === "no_hold") {
    return {
      passed: false,
      reason: "Gate Financiero: no existe hold de pago. No se puede despachar el servicio sin garantía de cobro.",
    };
  }

  if (v.holdStatus === "hold_expired") {
    return {
      passed: false,
      reason: "Gate Financiero: el hold de pago expiró. Se requiere un nuevo hold antes del despacho.",
    };
  }

  if (v.holdStatus === "hold_cancelled") {
    return {
      passed: false,
      reason: "Gate Financiero: el hold de pago fue cancelado. Se requiere un nuevo hold antes del despacho.",
    };
  }

  if (v.holdStatus === "hold_captured") {
    return {
      passed: true,
      reason: "Gate Financiero: hold ya capturado — pago confirmado.",
    };
  }

  // hold_active
  if (v.holdAmountCents < v.requiredAmountCents) {
    return {
      passed: false,
      reason: `Gate Financiero: hold activo pero insuficiente. Monto: $${(v.holdAmountCents / 100).toFixed(2)}, requerido: $${(v.requiredAmountCents / 100).toFixed(2)}.`,
    };
  }

  return {
    passed: true,
    reason: `Gate Financiero: hold activo por $${(v.holdAmountCents / 100).toFixed(2)}, cubre el monto requerido.`,
  };
}

// ── B.2.30 — Carga Biomecánica ───────────────────────────────────────────────

/** Input para el invariante de carga biomecánica. */
export const BiomechanicalLoadInputSchema = z.object({
  /** Puntaje total acumulado en la ventana de 72h. */
  totalScore72h: z.number().int().min(0)
    .describe("Puntaje total de carga biomecánica acumulado en 72h"),
  /** Máximo permitido en la ventana de 72h. */
  maxAllowed: z.number().int().min(1).default(10)
    .describe("Puntaje máximo permitido en 72h"),
  /** Puntaje del servicio que se intenta asignar. */
  serviceScore: z.number().int().min(1).max(5)
    .describe("Puntaje de carga del servicio a asignar"),
  /** Presupuesto restante del empleado. */
  remainingBudget: z.number().int().min(0)
    .describe("Presupuesto restante de carga en la ventana de 72h"),
});

/**
 * B.2.30: La carga biomecánica acumulada del empleado en 72 horas no debe
 * exceder el máximo permitido. Hard-block: si excede, el empleado NO puede
 * ser asignado al servicio.
 *
 * @returns InvariantResult: passed=false si la carga excede el máximo.
 */
export function enforceBiomechanicalLoad(
  input: z.infer<typeof BiomechanicalLoadInputSchema>
): InvariantResult {
  const v = BiomechanicalLoadInputSchema.parse(input);

  if (v.totalScore72h >= v.maxAllowed) {
    return {
      passed: false,
      reason: `Carga Biomecánica: hard-block activo. Acumulados ${v.totalScore72h}/${v.maxAllowed} puntos en 72h. Solo se permiten servicios de score 1.`,
    };
  }

  const projectedScore = v.totalScore72h + v.serviceScore;
  if (projectedScore > v.maxAllowed) {
    return {
      passed: false,
      reason: `Carga Biomecánica: el servicio (score ${v.serviceScore}) excede el presupuesto restante de ${v.remainingBudget} puntos. Proyectado: ${projectedScore}/${v.maxAllowed}. Se requiere alternancia a servicio liviano.`,
    };
  }

  return {
    passed: true,
    reason: `Carga Biomecánica: presupuesto suficiente. Actual: ${v.totalScore72h}/${v.maxAllowed}, con servicio: ${projectedScore}/${v.maxAllowed}.`,
  };
}

// ── B.2.31 — Bloqueo de Campañas ─────────────────────────────────────────────

/** Input para el invariante de bloqueo de campañas. */
export const CampaignLockInputSchema = z.object({
  /** ¿La campaña pasó la verificación de inventario? */
  inventoryVerified: z.boolean()
    .describe("true si la verificación de inventario a 14 días fue exitosa"),
  /** Items en déficit (si los hay). */
  deficitItemCount: z.number().int().min(0)
    .describe("Cantidad de items con stock insuficiente para la campaña"),
});

/**
 * B.2.31: Las campañas de marketing deben verificar suficiencia de
 * inventario (ventana de 14 días) antes de activarse. Si hay items en
 * déficit, la campaña se bloquea.
 *
 * @returns InvariantResult: passed=false si la campaña no pasó la verificación.
 */
export function enforceCampaignLock(
  input: z.infer<typeof CampaignLockInputSchema>
): InvariantResult {
  const v = CampaignLockInputSchema.parse(input);

  if (!v.inventoryVerified) {
    return {
      passed: false,
      reason: `Bloqueo Campañas: verificación de inventario fallida. ${v.deficitItemCount} item(s) en déficit para la ventana de 14 días. Campaña BLOQUEADA.`,
    };
  }

  return {
    passed: true,
    reason: "Bloqueo Campañas: verificación de inventario superada. Stock suficiente para 14 días.",
  };
}

// ── B.2.32 — Gracia Recurrente ───────────────────────────────────────────────

/** Input para el invariante de gracia recurrente. */
export const RecurringGraceInputSchema = z.object({
  /** ¿El cliente está en período de gracia activo? */
  isInGracePeriod: z.boolean()
    .describe("true si el cliente está en período de gracia activo"),
  /** ¿El período de gracia venció (15+ días sin pago)? */
  graceExpired: z.boolean()
    .describe("true si el período de gracia venció sin pago"),
  /** ¿El saldo pendiente ya fue liquidado? */
  balanceSettled: z.boolean()
    .describe("true si el cliente ya pagó el saldo pendiente"),
  /** ¿Se intentó cancelar el servicio por fallo de pago? */
  cancellationAttempted: z.boolean()
    .describe("true si se intentó cancelar el servicio en vez de activar gracia"),
});

/**
 * B.2.32: Un fallo de pago NO debe resultar en cancelación inmediata
 * del servicio. En su lugar, se activa un período de gracia de 15 días.
 *
 * Este invariante verifica que el flujo correcto se siguió:
 *   - Si hubo fallo de pago → debe haberse activado la gracia, no cancelado.
 *   - Si la gracia está activa → el servicio se completó igual.
 *   - Si la gracia venció sin pago → se pausan reservas, no se cancela
 *     retroactivamente el servicio.
 *
 * @returns InvariantResult: passed=false si se canceló en vez de activar gracia.
 */
export function enforceRecurringGrace(
  input: z.infer<typeof RecurringGraceInputSchema>
): InvariantResult {
  const v = RecurringGraceInputSchema.parse(input);

  if (v.cancellationAttempted && !v.balanceSettled) {
    return {
      passed: false,
      reason: "Gracia Recurrente: se intentó cancelar el servicio por fallo de pago en vez de activar el período de gracia de 15 días. Esto viola B.2.32.",
    };
  }

  if (v.graceExpired && !v.balanceSettled) {
    return {
      passed: true,
      reason: "Gracia Recurrente: período de gracia venció sin pago. Reservas futuras pausadas (acción correcta según B.2.32). El servicio completado NO se cancela retroactivamente.",
    };
  }

  if (v.isInGracePeriod) {
    return {
      passed: true,
      reason: "Gracia Recurrente: período de gracia activo. Servicio completado, saldo en Shadow Ledger, portal bloqueado hasta pago.",
    };
  }

  if (v.balanceSettled) {
    return {
      passed: true,
      reason: "Gracia Recurrente: saldo liquidado. Período de gracia resuelto correctamente.",
    };
  }

  return {
    passed: true,
    reason: "Gracia Recurrente: sin período de gracia activo. Cliente al día.",
  };
}

// ── B.2.33 — Anti-Gaming ────────────────────────────────────────────────────

/** Input para el invariante anti-gaming. */
export const AntiGamingInputSchema = z.object({
  /** Ratio de fricción del cliente (tickets/servicios). */
  frictionRatio: z.number().min(0)
    .describe("Ratio de fricción: tickets_abiertos / servicios_completados"),
  /** Umbral de fricción que dispara acciones. */
  frictionThreshold: z.number().min(0).max(1).default(0.25)
    .describe("Umbral de fricción (default 25%)"),
  /** ¿El cliente tiene suficientes servicios para que el ratio sea significativo? */
  hasEnoughHistory: z.boolean()
    .describe("true si el cliente tiene >= MIN_SERVICIOS_PARA_FRICCION servicios"),
  /** ¿Se aplicó QC sampling al servicio? (10% de auto-aprobaciones a revisión). */
  qcSamplingApplied: z.boolean()
    .describe("true si el servicio pasó por QC sampling (10% revisión humana)"),
  /** ¿El servicio era candidato a auto-aprobación? */
  wasAutoApprovalCandidate: z.boolean()
    .describe("true si el servicio habría sido auto-aprobado sin sampling"),
});

/**
 * B.2.33: Detección de fricción del cliente y muestreo QC.
 *
 * Dos verificaciones independientes:
 *   1. Fricción: si tickets/servicios > 25% Y hay suficiente historial →
 *      se deben aplicar restricciones (no esporádico, auditor obligatorio).
 *   2. QC Sampling: si el servicio era candidato a auto-aprobación →
 *      debe haberse aplicado el muestreo del 10% a revisión humana.
 *
 * @returns InvariantResult: passed=false si alguna verificación falla.
 */
export function enforceAntiGaming(
  input: z.infer<typeof AntiGamingInputSchema>
): InvariantResult {
  const v = AntiGamingInputSchema.parse(input);

  const frictionExceeded = v.hasEnoughHistory && v.frictionRatio > v.frictionThreshold;

  // Verificación 1: fricción del cliente
  if (frictionExceeded) {
    return {
      passed: false,
      reason: `Anti-Gaming: fricción del cliente excede el umbral (${Math.round(v.frictionRatio * 100)}% > ${Math.round(v.frictionThreshold * 100)}%). Se requieren restricciones: bloqueo esporádico, auditor obligatorio, modal admin.`,
    };
  }

  // Verificación 2: QC sampling
  if (v.wasAutoApprovalCandidate && !v.qcSamplingApplied) {
    return {
      passed: false,
      reason: "Anti-Gaming: servicio candidato a auto-aprobación no pasó por QC sampling (10% revisión humana requerida por B.2.33).",
    };
  }

  if (v.wasAutoApprovalCandidate && v.qcSamplingApplied) {
    return {
      passed: true,
      reason: "Anti-Gaming: QC sampling aplicado correctamente al servicio candidato a auto-aprobación.",
    };
  }

  return {
    passed: true,
    reason: "Anti-Gaming: sin fricción significativa. Servicio no era candidato a auto-aprobación.",
  };
}

// ── Enforcer agregado: ejecuta todos los invariantes ─────────────────────────

/** Input completo para ejecutar todos los invariantes. */
export interface AllInvariantsInput {
  /** B.2.26 — Inventory-Dispatch Gate */
  inventoryDispatch: z.infer<typeof InventoryDispatchGateInputSchema>;
  /** B.2.27 — Canal Telefónico Parity */
  telephonyParity: z.infer<typeof TelephonyParityInputSchema>;
  /** B.2.28 — Fallback Progresivo */
  progressiveFallback: z.infer<typeof ProgressiveFallbackInputSchema>;
  /** B.2.29 — Gate Financiero */
  financialGate: z.infer<typeof FinancialGateInputSchema>;
  /** B.2.30 — Carga Biomecánica */
  biomechanicalLoad: z.infer<typeof BiomechanicalLoadInputSchema>;
  /** B.2.31 — Bloqueo Campañas */
  campaignLock: z.infer<typeof CampaignLockInputSchema>;
  /** B.2.32 — Gracia Recurrente */
  recurringGrace: z.infer<typeof RecurringGraceInputSchema>;
  /** B.2.33 — Anti-Gaming */
  antiGaming: z.infer<typeof AntiGamingInputSchema>;
}

/**
 * Ejecuta los 8 invariantes ampliados y retorna el resultado agregado.
 *
 * Esta es la función principal que deben llamar los middlewares y edge
 * functions para validar que una operación crítica respeta TODOS los
 * invariantes de negocio.
 *
 * Cada invariante se ejecuta de forma independiente — el fallo de uno
 * no impide la evaluación de los demás, para dar visibilidad completa
 * al admin sobre qué reglas se están violando.
 *
 * @param input — Datos para todos los invariantes.
 * @param referenceIso — Timestamp de referencia para la evaluación.
 * @returns InvariantsEnforcementResult con el resultado de cada invariante.
 */
export function enforceAllInvariants(
  input: AllInvariantsInput,
  referenceIso: string
): InvariantsEnforcementResult {
  const results: Record<InvariantId, InvariantResult> = {
    "B.2.26_inventory_dispatch_gate": enforceInventoryDispatchGate(input.inventoryDispatch),
    "B.2.27_canal_telefonico_parity": enforceTelephonyParity(input.telephonyParity),
    "B.2.28_fallback_progresivo": enforceProgressiveFallback(input.progressiveFallback),
    "B.2.29_gate_financiero": enforceFinancialGate(input.financialGate),
    "B.2.30_carga_biomecanica": enforceBiomechanicalLoad(input.biomechanicalLoad),
    "B.2.31_bloqueo_campanas": enforceCampaignLock(input.campaignLock),
    "B.2.32_gracia_recurrente": enforceRecurringGrace(input.recurringGrace),
    "B.2.33_anti_gaming": enforceAntiGaming(input.antiGaming),
  };

  const failed: InvariantId[] = [];
  const passed: InvariantId[] = [];

  for (const id of INVARIANT_IDS) {
    if (results[id].passed) {
      passed.push(id);
    } else {
      failed.push(id);
    }
  }

  const allPassed = failed.length === 0;

  // Auditoría: loguear el resultado agregado.
  logEvent("sistema.invariants_enforced", {
    allPassed,
    failedCount: failed.length,
    passedCount: passed.length,
    failed,
    evaluatedAtIso: referenceIso,
  });

  return {
    evaluatedAtIso: referenceIso,
    results,
    allPassed,
    failed,
    passed,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Filtra solo los invariantes que fallaron y retorna sus razones.
 * Útil para logs de error y respuestas HTTP 422.
 *
 * @returns Array de {id, reason} para cada invariante fallido.
 */
export function getFailedInvariantReasons(
  enforcement: InvariantsEnforcementResult
): { id: InvariantId; reason: string }[] {
  return enforcement.failed.map((id) => ({
    id,
    reason: enforcement.results[id].reason,
  }));
}

/**
 * Verifica un invariante individual por ID usando los datos del input completo.
 * Útil cuando un middleware solo necesita verificar un invariante específico
 * sin ejecutar los 8.
 *
 * @param id — Identificador del invariante a verificar.
 * @param input — Input completo de todos los invariantes.
 * @returns InvariantResult del invariante solicitado.
 */
export function enforceSingleInvariant(
  id: InvariantId,
  input: AllInvariantsInput
): InvariantResult {
  switch (id) {
    case "B.2.26_inventory_dispatch_gate":
      return enforceInventoryDispatchGate(input.inventoryDispatch);
    case "B.2.27_canal_telefonico_parity":
      return enforceTelephonyParity(input.telephonyParity);
    case "B.2.28_fallback_progresivo":
      return enforceProgressiveFallback(input.progressiveFallback);
    case "B.2.29_gate_financiero":
      return enforceFinancialGate(input.financialGate);
    case "B.2.30_carga_biomecanica":
      return enforceBiomechanicalLoad(input.biomechanicalLoad);
    case "B.2.31_bloqueo_campanas":
      return enforceCampaignLock(input.campaignLock);
    case "B.2.32_gracia_recurrente":
      return enforceRecurringGrace(input.recurringGrace);
    case "B.2.33_anti_gaming":
      return enforceAntiGaming(input.antiGaming);
  }
}

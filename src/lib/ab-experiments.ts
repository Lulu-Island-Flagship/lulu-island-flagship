/**
 * v8.3 E10 (D.10.11) — Motor de experimentación A/B. Funciones puras.
 *
 * Restricciones éticas DURAS del spec, no negociables:
 *   - nunca segmentar por grupo demográfico
 *   - clientes recurrentes SIEMPRE protegidos (nunca entran a un experimento)
 *   - variante <20% del control (el control siempre es la mayoría)
 *   - log inmutable de qué variante vio cada cliente
 * Ganador: a 100 reservas/variante (precio) o 500 interacciones (copy) Y
 * confianza >95%. Métrica de precio = conversión × margen, NUNCA solo conversión
 * (un precio más bajo siempre convierte más; sin margen en la métrica el
 * experimento premiaría regalar el servicio).
 */

import type { ClientSegment } from "./client-segmentation";

/**
 * Auditoría E10 (fix): "cliente recurrente" no puede depender SOLO de tener
 * un service_contract activo (M13/contratos recurrentes) -- eso deja fuera a
 * cualquier VIP o Regular fiel que reserva a demanda sin contrato formal, y
 * la restricción ética del spec es "clientes recurrentes SIEMPRE
 * protegidos", no "clientes con contrato". Un cliente queda protegido si
 * cualquiera de las dos señales lo marca como recurrente: contrato activo O
 * segmentación VIP/Regular (src/lib/client-segmentation.ts).
 */
export function isProtectedRecurringClient(
  hasActiveServiceContract: boolean,
  segment: ClientSegment | null
): boolean {
  if (hasActiveServiceContract) return true;
  return segment === "vip" || segment === "regular";
}

export type ExperimentType = "price" | "copy" | "ui_ux" | "batch_schedule";

export interface ExperimentCandidate {
  clientId: string;
  isRecurring: boolean;
  demographicGroup?: string; // presente en el dato de origen, pero NUNCA debe usarse para asignar
}

export interface VariantConfig {
  name: string;
  weight: number; // proporcion del trafico, ej 0.1 = 10%
}

export interface AssignmentResult {
  clientId: string;
  variant: string | null; // null = excluido del experimento
  excludedReason?: string;
}

/**
 * Valida que la configuración de variantes respete "variante <20% del control".
 * Asume que la primera variante de la lista es el control.
 */
export function validateVariantWeights(variants: VariantConfig[]): { valid: boolean; reason?: string } {
  if (variants.length < 2) {
    return { valid: false, reason: "Se necesitan al menos 2 variantes (control + al menos 1 alternativa)." };
  }
  const control = variants[0];
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  if (Math.abs(totalWeight - 1) > 0.001) {
    return { valid: false, reason: `Los pesos deben sumar 1.0 (suman ${totalWeight}).` };
  }
  for (const v of variants.slice(1)) {
    if (v.weight >= control.weight) {
      return {
        valid: false,
        reason: `Variante '${v.name}' (${v.weight}) no puede ser >= al control '${control.name}' (${control.weight}). Máximo permitido: variante < 20% de tráfico total, control siempre mayoría.`,
      };
    }
  }
  return { valid: true };
}

/**
 * Asigna variante determinísticamente por clientId (mismo cliente siempre ve
 * la misma variante — requisito implícito para no confundir la métrica).
 * Clientes recurrentes quedan SIEMPRE excluidos, sin excepción.
 */
export function assignVariant(
  candidate: ExperimentCandidate,
  variants: VariantConfig[]
): AssignmentResult {
  if (candidate.isRecurring) {
    return { clientId: candidate.clientId, variant: null, excludedReason: "Cliente recurrente: protegido, nunca entra a experimentos." };
  }

  const validation = validateVariantWeights(variants);
  if (!validation.valid) {
    return { clientId: candidate.clientId, variant: null, excludedReason: `Configuración de experimento inválida: ${validation.reason}` };
  }

  // Hash determinístico simple sobre el clientId (mismo cliente = misma variante siempre)
  let hash = 0;
  for (let i = 0; i < candidate.clientId.length; i++) {
    hash = (hash * 31 + candidate.clientId.charCodeAt(i)) >>> 0;
  }
  const bucket = hash / 0xffffffff;

  let cumulative = 0;
  for (const v of variants) {
    cumulative += v.weight;
    if (bucket < cumulative) {
      return { clientId: candidate.clientId, variant: v.name };
    }
  }
  return { clientId: candidate.clientId, variant: variants[0].name }; // fallback al control
}

export interface VariantOutcome {
  variant: string;
  sampleSize: number;
  conversionRate: number; // 0-1
  marginRatio: number; // 0-1, margen de contribución promedio de esa variante
}

export interface WinnerResult {
  hasWinner: boolean;
  winner?: string;
  reason: string;
}

const MIN_SAMPLE_PRICE = 100;
const MIN_SAMPLE_COPY = 500;
const MIN_CONFIDENCE = 0.95;

/**
 * Métrica de precio = conversión × margen (nunca solo conversión). Umbral de
 * muestra distinto según tipo (D.10.11: precio 100 reservas/variante, copy
 * 500 interacciones). `confidence` se recibe ya calculado (z-test u otro
 * método estadístico — fuera del alcance de esta función pura) para no
 * reinventar estadística aquí; esta función solo aplica las reglas de negocio.
 */
export function evaluateExperimentWinner(
  outcomes: VariantOutcome[],
  type: ExperimentType,
  confidence: number
): WinnerResult {
  const minSample = type === "price" ? MIN_SAMPLE_PRICE : MIN_SAMPLE_COPY;

  const underSampled = outcomes.filter((o) => o.sampleSize < minSample);
  if (underSampled.length > 0) {
    return {
      hasWinner: false,
      reason: `Faltan datos: ${underSampled.map((o) => o.variant).join(", ")} no llega a ${minSample} muestras.`,
    };
  }

  if (confidence <= MIN_CONFIDENCE) {
    return { hasWinner: false, reason: `Confianza ${(confidence * 100).toFixed(1)}% no supera el umbral de ${MIN_CONFIDENCE * 100}%.` };
  }

  const scored = outcomes.map((o) => ({
    variant: o.variant,
    score: type === "price" ? o.conversionRate * o.marginRatio : o.conversionRate,
  }));
  scored.sort((a, b) => b.score - a.score);

  return {
    hasWinner: true,
    winner: scored[0].variant,
    reason: `${scored[0].variant} gana con score ${scored[0].score.toFixed(4)} (confianza ${(confidence * 100).toFixed(1)}%).`,
  };
}

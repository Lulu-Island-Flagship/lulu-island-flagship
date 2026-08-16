// ─── Impuestos BC — GST/PST (fuente única de tasas) ─────────────────────
// Migración v5.0 (ext-financial): la aritmética de impuestos es ENTERA y
// exacta (centavos bigint), sin multiplicar por floats 0.05/0.07.
// Las tasas `GST_RATE`/`PST_RATE` como `number` se conservan SOLO como
// metadatos de compatibilidad (coa-imputation, tax-netfile); para calcular
// dinero usa `computeTaxBreakdownCents` o `gstFromBaseCents`/`pstFromBaseCents`.

import {
  dollarsToCentsExact,
  centsToDollarsNumber,
  gstFromBaseCents,
  pstFromBaseCents,
  GST_RATE_NUMERATOR,
  GST_RATE_DENOMINATOR,
  PST_RATE_NUMERATOR,
  PST_RATE_DENOMINATOR,
} from "../money";

// Tasas legacy como `number` (solo lectura/metadatos, NO aritmética).
export const GST_RATE = Number(GST_RATE_NUMERATOR) / Number(GST_RATE_DENOMINATOR); // 0.05
export const PST_RATE = Number(PST_RATE_NUMERATOR) / Number(PST_RATE_DENOMINATOR); // 0.07
export const TOTAL_TAX_RATE = GST_RATE + PST_RATE; // 0.12

/**
 * Convierte dólares a centavos enteros, de forma exacta (sin `* 100` float).
 *   dollarsToCents(250.00)  → 25000
 *   dollarsToCents(19.99)   →  1999
 *   dollarsToCents(0)       →     0
 */
export function dollarsToCents(amount: number): number {
  return Number(dollarsToCentsExact(amount));
}

/**
 * Convierte centavos enteros a dólares (display/persistencia NUMERIC).
 *   centsToDollars(25000) → 250
 *   centsToDollars(1999)  → 19.99
 */
export function centsToDollars(cents: number): number {
  return centsToDollarsNumber(cents);
}

/**
 * Guarda defensiva: si un valor que DEBERÍA estar en centavos es < 100,
 * es casi seguro que alguien pasó dólares sin convertir. Loggea un warning
 * pero no revienta — el caller decide si lo trata como error fatal o no.
 *
 * Heurística: cualquier servicio de limpieza real cuesta ≥ $1.00 = 100¢.
 * Un valor < 100¢ sugiere fuertemente que se pasaron dólares (ej. 2.50
 * interpretado como 2.50¢ en vez de 250¢).
 *
 * @returns true si el valor parece razonable en centavos (≥ 100 o 0).
 */
export function assertCentsReasonable(cents: number, context?: string): boolean {
  if (cents > 0 && cents < 100) {
    console.warn(
      `[cents-guard] SUSPICIOUS: value ${cents}¢ (< $1.00) in context "${context ?? "unknown"}". ` +
      `This may indicate dollars were passed where cents were expected (missing ×100 conversion).`
    );
    return false;
  }
  return true;
}

/**
 * Desglose fiscal EXACTO en centavos `bigint` (API canónica bigint, v6.0).
 * Toda la aritmética (subtotal, GST, PST, total) es entera con tasas
 * racionales; garantiza por construcción subtotal + gst + pst === total.
 */
export interface TaxBreakdownCents {
  subtotalCents: bigint;
  gstCents: bigint;
  pstCents: bigint;
  totalCents: bigint;
}

export function computeTaxBreakdownCents(
  subtotalDollars: string | number,
): TaxBreakdownCents {
  let subtotalCents = dollarsToCentsExact(subtotalDollars);
  if (subtotalCents < 0n) subtotalCents = 0n;

  const gstCents = gstFromBaseCents(subtotalCents);
  const pstCents = pstFromBaseCents(subtotalCents);
  const totalCents = subtotalCents + gstCents + pstCents;

  return { subtotalCents, gstCents, pstCents, totalCents };
}

/**
 * Desglose fiscal exacto. Toda la aritmética (subtotal, GST, PST, total) se
 * hace en centavos enteros `bigint` con tasas racionales; solo al final se
 * convierte a dólares `number` para mostrar/persistir (wrapper de borde).
 * Garantiza por construcción: subtotal + gst + pst === total.
 */
export function computeTaxBreakdown(subtotalDollars: number): {
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
} {
  const breakdown = computeTaxBreakdownCents(subtotalDollars);
  return {
    subtotal: centsToDollarsNumber(breakdown.subtotalCents),
    gst: centsToDollarsNumber(breakdown.gstCents),
    pst: centsToDollarsNumber(breakdown.pstCents),
    total: centsToDollarsNumber(breakdown.totalCents),
  };
}

// ─── Utilidades de moneda ──────────────────────────────────────
// v8.3 H8 (auditoría 2026-08-06): extraídas de payroll.ts.
// Estas funciones son utilidades generales de conversión monetaria,
// no lógica de nómina. Cualquier módulo que necesite convertir
// dólares ↔ centavos debe importar desde aquí.
//
// v6.0 (ext-financial): la API canónica es bigint — `dollarsToCentsBigInt`.
// Los wrappers `dollarsToCents`/`centsToDollars` conservan firma number
// SOLO como borde de display/persistencia (PROTOCOLO §4) y delegan en
// el núcleo exacto de money.ts (nunca `x * 100` ni `(c/100).toFixed(2)`).

import { dollarsToCentsExact, centsToDollarsNumber } from "./money";

/**
 * Convierte un monto en dólares (string o number) a centavos `bigint`,
 * de forma exacta (sin multiplicación float). API canónica para cálculo.
 * Ejemplo: dollarsToCentsBigInt(18.25) → 1825n
 */
export function dollarsToCentsBigInt(dollars: string | number): bigint {
  return dollarsToCentsExact(dollars);
}

/**
 * Wrapper de borde (display/persistencia): dólares → centavos `number`.
 * Ejemplo: dollarsToCents(18.25) → 1825
 */
export function dollarsToCents(dollars: number): number {
  return Number(dollarsToCentsExact(dollars));
}

/**
 * Wrapper de borde (display/persistencia): centavos → dólares `number`.
 * Ejemplo: centsToDollars(1825) → 18.25
 */
export function centsToDollars(cents: number): number {
  return centsToDollarsNumber(cents);
}

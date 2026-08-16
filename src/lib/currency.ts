// ─── Utilidades de moneda ──────────────────────────────────────
// v8.3 H8 (auditoría 2026-08-06): extraídas de payroll.ts.
// Estas funciones son utilidades generales de conversión monetaria,
// no lógica de nómina. Cualquier módulo que necesite convertir
// dólares ↔ centavos debe importar desde aquí.

import { dollarsToCentsExact } from "./money";

/**
 * Convierte un monto en dólares a centavos enteros (exacto, sin float).
 * Ejemplo: dollarsToCents(18.25) → 1825
 */
export function dollarsToCents(dollars: number): number {
  return Number(dollarsToCentsExact(dollars));
}

/**
 * Convierte un monto en centavos a dólares con 2 decimales.
 * Ejemplo: centsToDollars(1825) → 18.25
 */
export function centsToDollars(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

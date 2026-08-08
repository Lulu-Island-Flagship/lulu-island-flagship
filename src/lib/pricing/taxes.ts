export const GST_RATE = 0.05; // 5%
export const PST_RATE = 0.07; // 7%
export const TOTAL_TAX_RATE = GST_RATE + PST_RATE; // 12%

/**
 * Convierte dólares (NUMERIC 10,2) a centavos enteros (INTEGER).
 * Usa Math.round para evitar errores de punto flotante (ej. 0.1 + 0.2).
 *
 *   dollarsToCents(250.00)  → 25000
 *   dollarsToCents(19.99)   →  1999
 *   dollarsToCents(0)       →     0
 */
export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convierte centavos enteros a dólares (NUMERIC 10,2).
 * La división puede producir decimales; el caller decide el redondeo.
 *
 *   centsToDollars(25000) → 250.00
 *   centsToDollars(1999)  →  19.99
 */
export function centsToDollars(cents: number): number {
  return cents / 100;
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
 * Fix (auditoría externa, hallazgo #2): antes el subtotal se manejaba en
 * dólares enteros (Math.round sin decimales) mientras GST/PST se redondeaban
 * por separado a centavos, y algunos call sites volvían a Math.round() el
 * subtotal después de sumarle el ajuste de reglas (perdiendo los centavos que
 * una regla `price_add`/`price_multiplier` pudiera introducir). Eso podía
 * producir subtotal + gst + pst !== total. Este helper hace TODA la
 * aritmética interna en centavos enteros (sin floats fraccionarios) y solo
 * convierte a dólares al final, para el único propósito de mostrar/persistir
 * el valor -- así el cuadre subtotal+gst+pst=total queda garantizado por
 * construcción.
 */
export function computeTaxBreakdown(subtotalDollars: number): {
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
} {
  const subtotalCents = Math.round(Math.max(0, subtotalDollars) * 100);
  const gstCents = Math.round(subtotalCents * GST_RATE);
  const pstCents = Math.round(subtotalCents * PST_RATE);
  const totalCents = subtotalCents + gstCents + pstCents;

  return {
    subtotal: subtotalCents / 100,
    gst: gstCents / 100,
    pst: pstCents / 100,
    total: totalCents / 100,
  };
}

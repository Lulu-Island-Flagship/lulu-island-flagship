/**
 * AR B2B — Aging module.
 *
 * Reporte de aging de cuentas por cobrar.
 */
import { type Factura } from "./invoice";

// =========================================================================
// Types
// =========================================================================

/**
 * Un bucket del reporte de aging de cuentas por cobrar.
 */
export interface AgingBucket {
  /** Etiqueta descriptiva del rango (ej. "0-30 días") */
  rango: string;
  /** Día mínimo del bucket (inclusive) */
  min_dias: number;
  /** Día máximo del bucket (inclusive) */
  max_dias: number;
  /** Total de saldo pendiente en este bucket, en centavos */
  total_cents: number;
  /** Cantidad de facturas en este bucket */
  facturas_count: number;
}

/**
 * Reporte completo de aging de cuentas por cobrar.
 */
export interface AgingReport {
  /** Fecha de corte del reporte (ISO 8601) */
  fecha_corte: string;
  /** Buckets de aging con sus totales */
  buckets: AgingBucket[];
  /** Total de saldo pendiente sumando todos los buckets, en centavos */
  total_pendiente_cents: number;
}

// =========================================================================
// Constants
// =========================================================================

/** Buckets para reporte de aging de cuentas por cobrar. */
export const AGING_BUCKETS = [
  { rango: "0-30 días", min_dias: 0, max_dias: 30 },
  { rango: "31-60 días", min_dias: 31, max_dias: 60 },
  { rango: "61-90 días", min_dias: 61, max_dias: 90 },
  { rango: ">90 días", min_dias: 91, max_dias: Number.POSITIVE_INFINITY },
] as const;

// =========================================================================
// Aging report
// =========================================================================

/**
 * Genera un reporte de aging de cuentas por cobrar.
 *
 * Clasifica las facturas pendientes de pago en buckets según los días
 * transcurridos desde su fecha de vencimiento hasta la fecha de corte.
 *
 * Buckets:
 *  - 0-30 días (corriente)
 *  - 31-60 días
 *  - 61-90 días
 *  - >90 días (cobranza)
 *
 * @param facturas — Lista de facturas a clasificar (se filtra solo PENDIENTE/VENCIDA/COBRANZA con saldo > 0).
 * @param fechaCorte — Fecha de corte del reporte (ISO 8601). Default: hoy.
 * @returns AgingReport con buckets y totales.
 */
export function getAgingReport(
  facturas: Factura[],
  fechaCorte?: string,
): AgingReport {
  const corte = fechaCorte
    ? new Date(`${fechaCorte}T00:00:00.000Z`)
    : new Date();
  const corteIso = corte.toISOString().slice(0, 10);

  // Inicializar buckets
  const buckets: AgingBucket[] = AGING_BUCKETS.map((b) => ({
    rango: b.rango,
    min_dias: b.min_dias,
    max_dias: b.max_dias === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : b.max_dias,
    total_cents: 0,
    facturas_count: 0,
  }));

  let totalPendiente = 0;

  for (const factura of facturas) {
    // Solo facturas no pagadas con saldo pendiente
    if (factura.estado === "PAGADA" || factura.saldo_pendiente <= 0) continue;

    const vencimiento = new Date(`${factura.fecha_vencimiento}T00:00:00.000Z`);
    const diasVencida = Math.floor(
      (corte.getTime() - vencimiento.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Clasificar en el bucket correspondiente
    for (const bucket of buckets) {
      if (
        diasVencida >= bucket.min_dias &&
        diasVencida <= bucket.max_dias
      ) {
        bucket.total_cents += factura.saldo_pendiente;
        bucket.facturas_count += 1;
        break;
      }
    }

    totalPendiente += factura.saldo_pendiente;
  }

  return {
    fecha_corte: corteIso,
    buckets,
    total_pendiente_cents: totalPendiente,
  };
}

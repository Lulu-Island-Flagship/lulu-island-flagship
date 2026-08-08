/**
 * AR B2B — Invoice generation module.
 *
 * Factura B2B types, Zod schemas, generation, status management, and payment application.
 */
import { z } from "zod";

// =========================================================================
// Constants
// =========================================================================

/** Días estándar de crédito para facturas B2B. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/** Tasas impositivas canadienses para facturación B2B. */
export const GST_RATE = 0.05; // 5% Goods and Services Tax (federal)
export const PST_RATE = 0.07; // 7% Provincial Sales Tax (BC)

// =========================================================================
// Domain types
// =========================================================================

/** Estado de una factura en el ciclo AR. */
export type InvoiceStatus = "PENDIENTE" | "PAGADA" | "VENCIDA" | "COBRANZA" | "ANULADA";

/** Tipos de línea en una factura. */
export type LineItemType = "servicio" | "upsell" | "producto" | "descuento";

/**
 * Una línea individual dentro de una factura B2B.
 */
export interface FacturaLinea {
  /** ID único de la línea dentro de la factura */
  linea_id: string;
  /** ID de la factura a la que pertenece */
  factura_id: string;
  /** Descripción del bien o servicio facturado */
  descripcion: string;
  /** Cantidad de unidades */
  cantidad: number;
  /** Precio unitario en centavos */
  precio_unitario: number;
  /** Total de la línea en centavos (cantidad × precio_unitario) */
  total: number;
  /** Tipo de línea: servicio base, upsell adicional, o producto */
  tipo: LineItemType;
}

/**
 * Desglose impositivo de una factura B2B.
 */
export interface FacturaTaxDetail {
  /** Subtotal antes de impuestos en centavos */
  subtotal_cents: number;
  /** GST 5% en centavos */
  gst_cents: number;
  /** PST 7% (BC) en centavos */
  pst_cents: number;
}

/**
 * Factura B2B emitida a un cliente corporativo.
 */
export interface Factura {
  /** ID único de la factura */
  factura_id: string;
  /** ID del cliente (referencia a la entidad cliente en el sistema) */
  cliente_id: string;
  /** ID de la orden de servicio que originó la factura (puede ser null si es manual) */
  orden_id: string | null;
  /** Fecha de emisión de la factura (ISO 8601) */
  fecha_emision: string;
  /** Fecha de vencimiento para el pago (ISO 8601) */
  fecha_vencimiento: string;
  /** Subtotal antes de impuestos en centavos */
  subtotal: number;
  /** GST 5% en centavos */
  gst_cents: number;
  /** PST 7% (BC) en centavos */
  pst_cents: number;
  /** Monto total de la factura en centavos (subtotal + GST + PST) */
  total: number;
  /** Saldo pendiente de pago en centavos (total - pagos recibidos) */
  saldo_pendiente: number;
  /** Estado actual de la factura */
  estado: InvoiceStatus;
  /** Líneas de detalle de la factura */
  lineas: FacturaLinea[];
}

// =========================================================================
// Zod schemas
// =========================================================================

export const FacturaLineaSchema = z.object({
  linea_id: z.string().min(1),
  factura_id: z.string().min(1),
  descripcion: z.string().min(1),
  cantidad: z.number().int().positive(),
  precio_unitario: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  tipo: z.enum(["servicio", "upsell", "producto", "descuento"]),
});

export const FacturaTaxDetailSchema = z.object({
  subtotal_cents: z.number().int().nonnegative(),
  gst_cents: z.number().int().nonnegative(),
  pst_cents: z.number().int().nonnegative(),
});

export const FacturaSchema = z.object({
  factura_id: z.string().min(1),
  cliente_id: z.string().min(1),
  orden_id: z.string().nullable(),
  fecha_emision: z.string().min(1),
  fecha_vencimiento: z.string().min(1),
  subtotal: z.number().int().nonnegative(),
  gst_cents: z.number().int().nonnegative(),
  pst_cents: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  saldo_pendiente: z.number().int().nonnegative(),
  estado: z.enum(["PENDIENTE", "PAGADA", "VENCIDA", "COBRANZA", "ANULADA"]),
  lineas: z.array(FacturaLineaSchema),
});

// =========================================================================
// Invoice generation
// =========================================================================

/**
 * Genera una factura B2B a partir de una orden de servicio.
 *
 * Crea la factura con sus líneas de detalle, calcula totales, establece
 * la fecha de vencimiento según los términos de pago (default 30 días),
 * y la deja en estado PENDIENTE.
 *
 * @param ordenId — ID de la orden de servicio origen.
 * @param clienteId — ID del cliente corporativo.
 * @param lineas — Líneas de detalle (descripción, cantidad, precio, tipo).
 * @param paymentTermsDays — Días de crédito (default 30).
 * @returns Factura creada y validada.
 */
export function generateInvoice(
  ordenId: string,
  clienteId: string,
  lineas: Omit<FacturaLinea, "linea_id" | "factura_id" | "total">[],
  paymentTermsDays: number = DEFAULT_PAYMENT_TERMS_DAYS,
): Factura {
  const facturaId = crypto.randomUUID();
  const today = new Date();
  const fechaEmision = today.toISOString().slice(0, 10);

  // Calcular fecha de vencimiento (días naturales)
  const vencimiento = new Date(today.getTime() + paymentTermsDays * 24 * 60 * 60 * 1000);
  const fechaVencimiento = vencimiento.toISOString().slice(0, 10);

  // Construir líneas con IDs y totales calculados
  const facturaLineas: FacturaLinea[] = lineas.map((l) => {
    const total = l.cantidad * l.precio_unitario;
    return FacturaLineaSchema.parse({
      linea_id: crypto.randomUUID(),
      factura_id: facturaId,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      total,
      tipo: l.tipo,
    });
  });

  // Subtotal = suma de líneas (los descuentos ya vienen como líneas negativas o con tipo "descuento")
  const subtotal = facturaLineas.reduce((sum, l) => sum + l.total, 0);

  // Calcular GST 5% y PST 7% sobre el subtotal
  const gstCents = Math.round(subtotal * GST_RATE);
  const pstCents = Math.round(subtotal * PST_RATE);
  const total = subtotal + gstCents + pstCents;

  return FacturaSchema.parse({
    factura_id: facturaId,
    cliente_id: clienteId,
    orden_id: ordenId,
    fecha_emision: fechaEmision,
    fecha_vencimiento: fechaVencimiento,
    subtotal,
    gst_cents: gstCents,
    pst_cents: pstCents,
    total,
    saldo_pendiente: total,
    estado: "PENDIENTE",
    lineas: facturaLineas,
  });
}

// =========================================================================
// Invoice status management
// =========================================================================

/**
 * Actualiza el estado de una factura según su fecha de vencimiento y
 * saldo pendiente.
 *
 * Reglas:
 *  - saldo_pendiente = 0 → PAGADA
 *  - saldo_pendiente > 0 y hoy > fecha_vencimiento:
 *    - >90 días vencida → COBRANZA
 *    - ≤90 días vencida → VENCIDA
 *  - saldo_pendiente > 0 y hoy ≤ fecha_vencimiento → PENDIENTE
 *
 * @param factura — Factura a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns El nuevo estado que corresponde.
 */
export function computeInvoiceStatus(
  factura: Factura,
  fechaReferencia?: string,
): InvoiceStatus {
  if (factura.saldo_pendiente <= 0) return "PAGADA";

  const referencia = fechaReferencia
    ? new Date(`${fechaReferencia}T00:00:00.000Z`)
    : new Date();

  const vencimiento = new Date(`${factura.fecha_vencimiento}T00:00:00.000Z`);
  const diasVencida = Math.floor(
    (referencia.getTime() - vencimiento.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diasVencida <= 0) return "PENDIENTE";
  if (diasVencida > 90) return "COBRANZA";
  return "VENCIDA";
}

/**
 * Aplica un pago parcial o total a una factura.
 *
 * Reduce el saldo pendiente y recalcula el estado. Si el pago es mayor
 * al saldo pendiente, el excedente se ignora (no genera saldo a favor).
 *
 * @param factura — Factura original (no se modifica).
 * @param amountCents — Monto del pago en centavos.
 * @returns Nueva factura con saldo y estado actualizados.
 */
export function applyPayment(
  factura: Factura,
  amountCents: number,
): Factura {
  const nuevoSaldo = Math.max(0, factura.saldo_pendiente - amountCents);
  const nuevaFactura: Factura = {
    ...factura,
    saldo_pendiente: nuevoSaldo,
    estado: nuevoSaldo <= 0 ? "PAGADA" : computeInvoiceStatus({ ...factura, saldo_pendiente: nuevoSaldo }),
  };

  return FacturaSchema.parse(nuevaFactura);
}

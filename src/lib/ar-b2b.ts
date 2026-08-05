/**
 * Capa 7 — AR B2B: Accounts Receivable (Cuentas por Cobrar) para facturación B2B.
 *
 * Gestiona el ciclo completo de facturación a clientes corporativos:
 *   1. Emisión de factura desde una orden de servicio
 *   2. Registro contable: Débito AR (1-1020) / Crédito Revenue (4-4010)
 *   3. Seguimiento de saldos pendientes (aging)
 *   4. Flujo de cobranza (dunning): recordatorio → aviso → llamada → cobranza
 *   5. Registro contable de cobro: Débito Efectivo (1-1000) / Crédito AR (1-1020)
 *
 * Principios:
 *  - Todas las funciones son puras: no tocan base de datos.
 *  - Los montos se representan en centavos (enteros).
 *  - Los asientos contables se generan vía generateJournalEntry del Financial Ledger.
 *  - Validación Zod en todas las entidades de dominio.
 *
 * Estados de factura:
 *   PENDIENTE — emitida, dentro del plazo de pago
 *   PAGADA — saldo_pendiente = 0
 *   VENCIDA — pasó fecha_vencimiento y saldo_pendiente > 0
 *   COBRANZA — >90 días vencida, escalada a gestión de cobro
 *
 * Etapas de dunning (cobranza preventiva):
 *   Día 31: recordatorio amable por email
 *   Día 45: segundo aviso con copia al contacto financiero
 *   Día 60: llamada telefónica al cliente
 *   Día 90: escalación a cobranza externa / legal
 */

import { createHash } from "@/lib/crypto";
import { z } from "zod";
import {
  generateJournalEntry,
  CHART_OF_ACCOUNTS,
  JournalEntryRowSchema,
  type BusinessEvent,
  type CuentaContable,
  type JournalEntryRow,
  type LedgerEntryStatus,
} from "@/lib/financial-ledger";

// =========================================================================
// Constants
// =========================================================================

/** Días estándar de crédito para facturas B2B. */
export const DEFAULT_PAYMENT_TERMS_DAYS = 30;

/** Tasas impositivas canadienses para facturación B2B. */
export const GST_RATE = 0.05; // 5% Goods and Services Tax (federal)
export const PST_RATE = 0.07; // 7% Provincial Sales Tax (BC)

/** Etapas del flujo de dunning. */
export const DUNNING_STAGES = [
  { etapa: "recordatorio" as const, dias: 31, descripcion: "Recordatorio amable de pago por email" },
  { etapa: "segundo_aviso" as const, dias: 45, descripcion: "Segundo aviso — copia a contacto financiero" },
  { etapa: "llamada" as const, dias: 60, descripcion: "Llamada telefónica al cliente" },
  { etapa: "cobranza" as const, dias: 90, descripcion: "Escalación a cobranza externa / legal" },
] as const;

/** Buckets para reporte de aging de cuentas por cobrar. */
export const AGING_BUCKETS = [
  { rango: "0-30 días", min_dias: 0, max_dias: 30 },
  { rango: "31-60 días", min_dias: 31, max_dias: 60 },
  { rango: "61-90 días", min_dias: 61, max_dias: 90 },
  { rango: ">90 días", min_dias: 91, max_dias: Number.POSITIVE_INFINITY },
] as const;

// =========================================================================
// Domain types
// =========================================================================

/** Estado de una factura en el ciclo AR. */
export type InvoiceStatus = "PENDIENTE" | "PAGADA" | "VENCIDA" | "COBRANZA" | "ANULADA";

/** Tipos de línea en una factura. */
export type LineItemType = "servicio" | "upsell" | "producto" | "descuento";

/** Etapas del proceso de dunning. */
export type DunningStage = "recordatorio" | "segundo_aviso" | "llamada" | "cobranza";

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
 * Factura B2B emitida a un cliente corporativo.
 */
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

/**
 * Registro de una acción de dunning sobre una factura vencida.
 */
export interface DunningRecord {
  /** ID de la factura */
  factura_id: string;
  /** Etapa del flujo de dunning alcanzada */
  etapa: DunningStage;
  /** Días transcurridos desde la fecha de emisión */
  dias_desde_emision: number;
  /** Fecha en que se ejecuta la acción de dunning (ISO 8601) */
  fecha_accion: string;
  /** Mensaje o descripción de la acción */
  mensaje: string;
}

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
// AR Journal Entry generation
// =========================================================================

/**
 * Calcula SHA-256 para una fila del ledger usando el mismo algoritmo
 * canónico que financial-ledger.ts (campos concatenados con `|`).
 */
function computeRowHash(row: Omit<JournalEntryRow, "hash_sha256">): string {
  const canonical = [
    row.event_id,
    row.event_type,
    row.timestamp,
    row.periodo_contable,
    row.cuenta_debito ?? "",
    row.cuenta_credito ?? "",
    String(row.monto),
    row.moneda,
    row.descripcion,
    JSON.stringify(row.referencia),
    row.estado,
    row.creado_por,
  ].join("|");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Genera el asiento contable completo por la emisión de una factura B2B.
 *
 * Asiento de 4 filas (partida doble con desglose impositivo):
 *   Débito:  CUENTAS_POR_COBRAR_AR (1-1020) — activo, derecho de cobro — TOTAL
 *   Crédito: INGRESOS_SERVICIOS_4010 (4-4010) — ingreso devengado — SUBTOTAL
 *   Crédito: GST_PAYABLE (2-2020) — GST 5% cobrado al cliente
 *   Crédito: PST_PAYABLE (2-2030) — PST 7% cobrado al cliente
 *
 * Invariante: subtotal + gst_cents + pst_cents = total → SUM(débito) = SUM(crédito)
 *
 * @param factura — Factura emitida con desglose impositivo.
 * @param userId — UUID del usuario que genera la factura.
 * @returns Array de JournalEntryRow (4 filas: 1 débito + 3 crédito).
 */
export function generateInvoiceJournalEntry(
  factura: Factura,
  userId: string,
): JournalEntryRow[] {
  const ledgerId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const timestamp = `${factura.fecha_emision}T00:00:00.000Z`;
  const periodo = factura.fecha_emision.slice(0, 7);
  const referencia = {
    factura_id: factura.factura_id,
    cliente_id: factura.cliente_id,
    orden_id: factura.orden_id,
    lineas_count: factura.lineas.length,
    subtotal_cents: factura.subtotal,
    gst_cents: factura.gst_cents,
    pst_cents: factura.pst_cents,
  };

  const rows: Omit<JournalEntryRow, "hash_sha256">[] = [
    // 1. DÉBITO: Cuentas por Cobrar AR (activo) — monto total de la factura
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR_AR as CuentaContable,
      cuenta_credito: null,
      monto: factura.total,
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — AR [DÉBITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
    // 2. CRÉDITO: Ingresos por Servicios (revenue) — subtotal sin impuestos
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010 as CuentaContable,
      monto: factura.subtotal,
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — Revenue [CRÉDITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
    // 3. CRÉDITO: GST Payable — 5% cobrado pendiente de remitir a CRA
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: CHART_OF_ACCOUNTS.GST_PAYABLE as CuentaContable,
      monto: factura.gst_cents,
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — GST 5% [CRÉDITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
    // 4. CRÉDITO: PST Payable — 7% BC cobrado pendiente de remitir
    {
      ledger_id: ledgerId,
      event_id: eventId,
      event_type: "ar_invoice_generated",
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: CHART_OF_ACCOUNTS.PST_PAYABLE as CuentaContable,
      monto: factura.pst_cents,
      moneda: "CAD",
      descripcion: `Factura B2B ${factura.factura_id} — PST 7% [CRÉDITO] — ${factura.orden_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado" as LedgerEntryStatus,
      creado_por: userId,
    },
  ];

  // Validar invariante contable: SUM(débito) = SUM(crédito)
  const sumDebito = rows
    .filter((r) => r.cuenta_debito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  const sumCredito = rows
    .filter((r) => r.cuenta_credito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  if (sumDebito !== sumCredito) {
    throw new Error(
      `generateInvoiceJournalEntry: invariante contable rota — SUM(débito)=${sumDebito} ≠ SUM(crédito)=${sumCredito}`
    );
  }

  // Calcular hash SHA-256 de cada fila y validar con Zod
  return rows.map((row) => {
    const hash = computeRowHash(row);
    return JournalEntryRowSchema.parse({ ...row, hash_sha256: hash });
  });
}

/**
 * Genera el asiento contable por el cobro de una factura B2B (pago recibido).
 *
 * Asiento:
 *   Débito:  EFECTIVO (1-1000) — entra dinero
 *   Crédito: CUENTAS_POR_COBRAR_AR (1-1020) — se liquida el derecho de cobro
 *
 * @param factura — Factura que se está cobrando (para referencia).
 * @param amountCents — Monto recibido en centavos.
 * @param userId — UUID del usuario que registra el cobro.
 * @param paymentReference — Referencia externa del pago (ej. transaction_id del banco).
 * @returns Array de JournalEntryRow (2 filas: débito + crédito).
 */
export function generatePaymentJournalEntry(
  factura: Factura,
  amountCents: number,
  userId: string,
  paymentReference?: string,
): JournalEntryRow[] {
  const event: BusinessEvent = {
    event_id: crypto.randomUUID(),
    event_type: "ar_payment_received",
    order_id: factura.orden_id,
    user_id: userId,
    amount_cents: amountCents,
    currency: "CAD",
    processor: "internal",
    external_reference: paymentReference ?? factura.factura_id,
    occurred_at: new Date().toISOString(),
    metadata: {
      factura_id: factura.factura_id,
      cliente_id: factura.cliente_id,
    },
  };

  return generateJournalEntry(event);
}

/**
 * Registra un pago sobre una factura B2B: actualiza el saldo pendiente
 * y genera el asiento contable correspondiente.
 *
 * Asiento contable del cobro:
 *   Débito:  EFECTIVO (1-1000) — entra dinero
 *   Crédito: CUENTAS_POR_COBRAR_AR (1-1020) — se liquida el derecho de cobro
 *
 * @param factura — Factura original (no se modifica; se devuelve copia actualizada).
 * @param monto — Monto del pago en centavos.
 * @param metodo — Método de pago (ej. "transferencia", "cheque", "efectivo").
 * @param referencia — Referencia externa o identificador del pago.
 * @param userId — UUID del usuario que registra el cobro.
 * @returns Factura actualizada + filas del asiento contable de cobro.
 */
export function recordPayment(
  factura: Factura,
  monto: number,
  metodo: string,
  referencia: string,
  userId: string,
): { factura: Factura; journalEntries: JournalEntryRow[] } {
  const facturaActualizada = applyPayment(factura, monto);
  const journalEntries = generatePaymentJournalEntry(
    factura,
    monto,
    userId,
    referencia,
  );
  return { factura: facturaActualizada, journalEntries };
}

// =========================================================================
// Dunning flow
// =========================================================================

/**
 * Determina la etapa de dunning que corresponde a una factura según los
 * días transcurridos desde su emisión.
 *
 * Etapas:
 *  - Día 31: recordatorio
 *  - Día 45: segundo aviso
 *  - Día 60: llamada
 *  - Día 90: cobranza
 *
 * Si no se ha alcanzado ninguna etapa (≤30 días), devuelve null.
 *
 * @param factura — Factura a evaluar.
 * @param fechaReferencia — Fecha de referencia para el cálculo (default: hoy).
 * @returns DunningRecord si corresponde una acción, null si aún no.
 */
export function getDunningStage(
  factura: Factura,
  fechaReferencia?: string,
): DunningRecord | null {
  // Solo facturas con saldo pendiente entran en dunning
  if (factura.saldo_pendiente <= 0) return null;

  const referencia = fechaReferencia
    ? new Date(`${fechaReferencia}T00:00:00.000Z`)
    : new Date();

  const emision = new Date(`${factura.fecha_emision}T00:00:00.000Z`);
  const diasDesdeEmision = Math.floor(
    (referencia.getTime() - emision.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Recorrer etapas de mayor a menor para encontrar la más avanzada aplicable
  const etapasOrdenadas = [...DUNNING_STAGES].sort((a, b) => b.dias - a.dias);

  for (const etapa of etapasOrdenadas) {
    if (diasDesdeEmision >= etapa.dias) {
      const fechaAccion = new Date(
        emision.getTime() + etapa.dias * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);

      return {
        factura_id: factura.factura_id,
        etapa: etapa.etapa,
        dias_desde_emision: diasDesdeEmision,
        fecha_accion: fechaAccion,
        mensaje: etapa.descripcion,
      };
    }
  }

  return null;
}

/**
 * Obtiene la próxima acción de dunning pendiente para una factura.
 *
 * A diferencia de getDunningStage (que devuelve la etapa actual alcanzada),
 * esta función devuelve la PRÓXIMA etapa que se debe ejecutar cuando
 * se alcancen los días correspondientes.
 *
 * @param factura — Factura a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns La próxima etapa de dunning o null si ya pasaron todas o no aplica.
 */
export function getNextDunningAction(
  factura: Factura,
  fechaReferencia?: string,
): DunningRecord | null {
  if (factura.saldo_pendiente <= 0) return null;

  const referencia = fechaReferencia
    ? new Date(`${fechaReferencia}T00:00:00.000Z`)
    : new Date();

  const emision = new Date(`${factura.fecha_emision}T00:00:00.000Z`);
  const diasDesdeEmision = Math.floor(
    (referencia.getTime() - emision.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Buscar la primera etapa cuyo umbral de días sea mayor que el actual
  for (const etapa of DUNNING_STAGES) {
    if (diasDesdeEmision < etapa.dias) {
      const fechaAccion = new Date(
        emision.getTime() + etapa.dias * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);

      return {
        factura_id: factura.factura_id,
        etapa: etapa.etapa,
        dias_desde_emision: diasDesdeEmision,
        fecha_accion: fechaAccion,
        mensaje: etapa.descripcion,
      };
    }
  }

  return null; // Ya pasaron todas las etapas
}

/**
 * Filtra las facturas vencidas con saldo pendiente > 0 desde una colección.
 *
 * Una factura se considera vencida si su fecha_vencimiento es anterior a la
 * fecha de referencia y aún tiene saldo_pendiente > 0. Se excluyen facturas
 * PAGADAS y ANULADAS.
 *
 * @param facturas — Lista de facturas a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns Facturas vencidas no pagadas, ordenadas por días de mora descendente.
 */
export function getOverdueInvoices(
  facturas: Factura[],
  fechaReferencia?: string,
): Factura[] {
  const referencia = fechaReferencia
    ? new Date(fechaReferencia + "T00:00:00.000Z")
    : new Date();

  return facturas
    .filter((f) => {
      if (f.estado === "PAGADA" || f.estado === "ANULADA") return false;
      if (f.saldo_pendiente <= 0) return false;
      const vencimiento = new Date(f.fecha_vencimiento + "T00:00:00.000Z");
      return vencimiento < referencia;
    })
    .sort((a, b) => {
      const diasA =
        (referencia.getTime() -
          new Date(a.fecha_vencimiento + "T00:00:00.000Z").getTime()) /
        (1000 * 60 * 60 * 24);
      const diasB =
        (referencia.getTime() -
          new Date(b.fecha_vencimiento + "T00:00:00.000Z").getTime()) /
        (1000 * 60 * 60 * 24);
      return diasB - diasA; // Más vencidas primero
    });
}

/**
 * Retorna las acciones de dunning sugeridas para un conjunto de facturas,
 * agrupadas por etapa del flujo de cobranza.
 *
 * Cada acción incluye la factura asociada, la etapa correspondiente, y
 * el mensaje recomendado. Solo se incluyen facturas con saldo pendiente > 0
 * que hayan alcanzado al menos la etapa de recordatorio (31 días).
 *
 * Buckets del flujo:
 *  - 31 días: recordatorio amable por email
 *  - 45 días: segundo aviso con copia a contacto financiero
 *  - 60 días: llamada telefónica al cliente
 *  - 90 días: escalación a cobranza externa / legal
 *
 * @param facturas — Lista de facturas a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns Acciones de dunning sugeridas, agrupadas por factura.
 */
export function getDunningActions(
  facturas: Factura[],
  fechaReferencia?: string,
): DunningRecord[] {
  const acciones: DunningRecord[] = [];

  for (const factura of facturas) {
    const accion = getDunningStage(factura, fechaReferencia);
    if (accion) {
      acciones.push(accion);
    }
  }

  // Ordenar: etapa más avanzada primero (cobranza → recordatorio), luego por días descendente
  const etapaOrden: Record<DunningStage, number> = {
    cobranza: 4,
    llamada: 3,
    segundo_aviso: 2,
    recordatorio: 1,
  };

  return acciones.sort((a, b) => {
    const cmp = (etapaOrden[b.etapa] ?? 0) - (etapaOrden[a.etapa] ?? 0);
    if (cmp !== 0) return cmp;
    return b.dias_desde_emision - a.dias_desde_emision;
  });
}

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

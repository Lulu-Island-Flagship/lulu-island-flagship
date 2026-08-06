/**
 * v9.0 Capa 0 — Financial Ledger (Partida Doble).
 *
 * Reemplaza shadow-ledger.ts (single-entry operativo) con un libro mayor
 * contable de partida doble. Cada BusinessEvent genera una JournalEntry
 * con al menos 2 filas (una de débito, una de crédito) que comparten el
 * mismo `ledger_id`.
 *
 * Principios:
 *  - Event-aware, NO event-driven. No hay Event Bus. El evento de negocio,
 *    dentro de la misma transacción DB, llama a generateJournalEntry(). Si
 *    el JE falla (validación Zod o invariante contable rota), el evento de
 *    negocio falla — no hay escritura parcial.
 *  - Trigger PostgreSQL en `financial_ledger` que valida
 *    SUM(monto en filas débito) = SUM(monto en filas crédito) por ledger_id.
 *    Si falla, ROLLBACK atómico.
 *  - Hash SHA-256 por fila para auditoría e inmutabilidad.
 *  - Estado tri-estado: confirmado, reversado, ajuste. Una vez confirmado o
 *    reversado, no se edita — se genera una nueva entrada de ajuste.
 *
 * Plan de Cuentas (Chart of Accounts):
 *   Activos (1xxx):
 *     1-1000  Efectivo y Equivalentes
 *     1-1020  Cuentas por Cobrar — Clientes (AR B2B)
 *     1-1100  Cuentas por Cobrar — Clientes
 *     1-1200  Fondos Retenidos (Stripe/PayPal holds)
 *     1-2025  GST Input Tax Credits Receivable
 *   Pasivos (2xxx):
 *     2-1000  Depósitos de Clientes — Contingente (holds)
 *     2-2020  GST Payable
 *     2-2030  PST Payable
 *   Ingresos (4xxx):
 *     4-1000  Ingresos por Servicios
 *     4-2000  Ingresos por Penalidades de Cancelación
 *     4-4010  Ingresos por Servicios Operativos (coa 4010)
 *   Contra-Ingresos (5xxx):
 *     5-1000  Reembolsos Emitidos
 *
 * Interconexiones:
 *   financial-ledger.ts ──(importado por)──→ order-cancellation.ts
 *   financial-ledger.ts ──(importado por)──→ batch-capture-*.ts
 *   financial-ledger.ts ──(importado por)──→ stripe webhook handlers
 *   financial-ledger.ts ──(importado por)──→ paypal handlers
 *   financial-ledger.ts ──(importado por)──→ qbo-sync.ts (futuro)
 *   financial-ledger.ts ──(importado por)──→ ledger-reconciliation.ts
 *   financial-ledger.ts ──(importado por)──→ tax-engine.ts (Capa 5)
 *   financial-ledger.ts ──(importado por)──→ ar-b2b.ts (Capa 7)
 *   financial-ledger.ts ──(importado por)──→ bank-reconciliation.ts (Capa 7)
 */

import { createHash } from "@/lib/crypto.server";
import { z } from "zod";

// =========================================================================
// Chart of Accounts — Plan de Cuentas canónico
// =========================================================================

export const CHART_OF_ACCOUNTS = {
  /** Efectivo y Equivalentes — dinero ya depositado / disponible */
  EFECTIVO: "1-1000",
  /** Cuentas por Cobrar — Clientes — facturas emitidas pendientes de cobro */
  CUENTAS_POR_COBRAR: "1-1100",
  /** Fondos Retenidos — holds/autorizaciones Stripe/PayPal aún no capturados */
  FONDOS_RETENIDOS: "1-1200",
  /** Ingresos por Servicios — revenue operativo por servicios prestados */
  INGRESOS_SERVICIOS: "4-1000",
  /** Ingresos por Penalidades de Cancelación */
  INGRESOS_PENALIDADES: "4-2000",
  /** Reembolsos Emitidos — contra-ingreso por devoluciones al cliente */
  REEMBOLSOS_EMITIDOS: "5-1000",
  /** Depósitos de Clientes — Contingente — pasivo mientras el hold no se captura */
  DEPOSITOS_CONTINGENTES: "2-1000",
  // ── Capas 5 & 7: Tax Engine, AR B2B, Bank Reconciliation ──────────
  /** Cuentas por Cobrar B2B (coa 1020) — facturas emitidas pendientes de cobro */
  CUENTAS_POR_COBRAR_AR: "1-1020",
  /** GST Input Tax Credits Receivable (coa 2025) — GST pagado en compras/gastos, compensable */
  GST_ITC_RECEIVABLE: "1-2025",
  /** GST Payable (coa 2020) — GST/HST 5% cobrado a clientes pendiente de remitir a CRA */
  GST_PAYABLE: "2-2020",
  /** PST Payable (coa 2030) — PST provincial BC 7% cobrado a clientes pendiente de remitir */
  PST_PAYABLE: "2-2030",
  /** Ingresos por Servicios Operativos (coa 4010) — revenue de facturación B2B */
  INGRESOS_SERVICIOS_4010: "4-4010",
  NOMINA: "5-2000",
} as const;

export type CuentaContable = (typeof CHART_OF_ACCOUNTS)[keyof typeof CHART_OF_ACCOUNTS];

// =========================================================================
// Domain types
// =========================================================================

/**
 * Eventos de negocio que disparan un asiento contable.
 * Extiende los tipos del Shadow Ledger original para mantener
 * compatibilidad semántica con los callers existentes.
 */
export type BusinessEventType =
  | "hold_authorized"
  | "hold_captured"
  | "hold_released"
  | "balance_captured"
  | "cancellation_penalty"
  | "paypal_advance_received"
  | "paypal_refund"
  | "capture_failed"
  | "warranty_refund"
  | "wallet_full_payment_received"
  | "wallet_refund"
  // ── Capas 5 & 7: Tax Engine, AR B2B, Bank Reconciliation ──────────
  | "tax_gst_accrual"
  | "tax_pst_accrual"
  | "ar_invoice_generated"
  | "ar_payment_received"
  | "bank_reconciled"
  // ── Capa 4: Payroll Engine ──────────────────────────────────────────
  | "payroll_disbursement";

/** Procesador de pago que originó el evento. */
export type PaymentProcessor = "stripe" | "paypal" | "internal";

/**
 * Evento de negocio que entra al Financial Ledger.
 * Es el contrato de entrada: todo caller que quiera registrar un movimiento
 * contable debe armar este objeto y pasarlo a generateJournalEntry().
 */
export interface BusinessEvent {
  event_id: string;
  event_type: BusinessEventType;
  order_id: string | null;
  user_id: string | null;
  /** Magnitud en centavos, siempre >= 0. La dirección (débito/crédito) la determina event_type. */
  amount_cents: number;
  currency: string;
  processor: PaymentProcessor;
  external_reference: string | null;
  occurred_at: Date | string;
  metadata?: Record<string, unknown>;
}

/**
 * Estado de una fila del ledger.
 * - confirmado: asiento firme, no reversible directamente.
 * - reversado: anulado por una entrada posterior de reversión.
 * - ajuste: entrada correctiva (no borra la original, la complementa).
 */
export type LedgerEntryStatus = "confirmado" | "reversado" | "ajuste";

/**
 * Una fila individual del libro mayor contable.
 *
 * En partida doble, cada fila representa UN lado de la transacción:
 * - Si es débito: `cuenta_debito` tiene el código de cuenta y `cuenta_credito` es null.
 * - Si es crédito: `cuenta_credito` tiene el código de cuenta y `cuenta_debito` es null.
 *
 * Todas las filas de una misma transacción comparten el mismo `ledger_id`.
 * La suma de montos en filas débito DEBE igualar la suma en filas crédito
 * (validado por trigger PostgreSQL y por la función generateJournalEntry).
 */
export interface JournalEntryRow {
  ledger_id: string;
  event_id: string;
  event_type: BusinessEventType;
  timestamp: string;
  periodo_contable: string;
  cuenta_debito: CuentaContable | null;
  cuenta_credito: CuentaContable | null;
  monto: number;
  moneda: string;
  descripcion: string;
  referencia: Record<string, unknown>;
  estado: LedgerEntryStatus;
  hash_sha256: string;
  creado_por: string;
}

// =========================================================================
// Zod Schemas — validación estricta de entrada y salida
// =========================================================================

const BusinessEventTypeSchema = z.enum([
  "hold_authorized",
  "hold_captured",
  "hold_released",
  "balance_captured",
  "cancellation_penalty",
  "paypal_advance_received",
  "paypal_refund",
  "capture_failed",
  "warranty_refund",
  "wallet_full_payment_received",
  "wallet_refund",
  // ── Capas 5 & 7 ──
  "tax_gst_accrual",
  "tax_pst_accrual",
  "ar_invoice_generated",
  "ar_payment_received",
  "bank_reconciled",
]);

const PaymentProcessorSchema = z.enum(["stripe", "paypal", "internal"]);

export const BusinessEventSchema = z.object({
  event_id: z.string().min(1, "event_id es requerido"),
  event_type: BusinessEventTypeSchema,
  order_id: z.string().nullable(),
  user_id: z.string().nullable(),
  amount_cents: z
    .number()
    .int("amount_cents debe ser entero (centavos)")
    .nonnegative("amount_cents debe ser >= 0 (magnitud, la dirección la da event_type)"),
  currency: z.string().default("CAD"),
  processor: PaymentProcessorSchema,
  external_reference: z.string().nullable(),
  occurred_at: z.date().or(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const LedgerEntryStatusSchema = z.enum(["confirmado", "reversado", "ajuste"]);

const CuentaContableSchema = z.enum([
  "1-1000",
  "1-1100",
  "1-1200",
  "2-1000",
  "4-1000",
  "4-2000",
  "5-1000",
  // ── Capas 5 & 7 ──
  "1-1020",
  "1-2025",
  "2-2020",
  "2-2030",
  "4-4010",
]);

export const JournalEntryRowSchema = z.object({
  ledger_id: z.string().min(1),
  event_id: z.string().min(1),
  event_type: BusinessEventTypeSchema,
  timestamp: z.string().min(1),
  periodo_contable: z.string().regex(/^\d{4}-\d{2}$/, "periodo_contable debe ser YYYY-MM"),
  cuenta_debito: CuentaContableSchema.nullable(),
  cuenta_credito: CuentaContableSchema.nullable(),
  monto: z.number().int().nonnegative("monto debe ser >= 0 (centavos enteros)"),
  moneda: z.literal("CAD"),
  descripcion: z.string().min(1),
  referencia: z.record(z.string(), z.unknown()),
  estado: LedgerEntryStatusSchema,
  hash_sha256: z.string().length(64, "hash_sha256 debe tener exactamente 64 caracteres hex"),
  creado_por: z.string().min(1),
});

// =========================================================================
// Helpers
// =========================================================================

/**
 * Deriva el periodo contable (YYYY-MM) de una fecha ISO.
 */
function toPeriodoContable(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/**
 * Calcula SHA-256 hexadecimal del contenido canónico de una fila.
 * Los campos se concatenan en orden fijo con separador `|` para que el hash
 * sea determinístico y verificable.
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
 * Normaliza una fecha (Date | string) a ISO string.
 */
function toISOString(occurredAt: Date | string): string {
  return typeof occurredAt === "string" ? occurredAt : occurredAt.toISOString();
}

// =========================================================================
// Mapa de EventType → (cuenta_debito, cuenta_credito, descripcion)
// =========================================================================

interface AccountMapping {
  cuenta_debito: CuentaContable | null;
  cuenta_credito: CuentaContable | null;
  descripcion: string;
}

/**
 * Mapa canónico de cada tipo de evento de negocio a su asiento contable.
 *
 * Cada entrada define la cuenta que recibe el débito y la cuenta que recibe
 * el crédito. La función generateJournalEntry parte este par en dos filas
 * (una débito, una crédito) que comparten el mismo ledger_id y monto.
 *
 * Principio contable: el débito representa "a dónde va el valor", el crédito
 * representa "de dónde sale el valor".
 */
const EVENT_ACCOUNT_MAP: Record<BusinessEventType, AccountMapping> = {
  // ── Cobros (dinero entra a la empresa) ──────────────────────────────
  hold_captured: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Captura de hold — cobro efectivo",
  },
  balance_captured: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Captura de saldo pendiente — cobro efectivo",
  },
  paypal_advance_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Anticipo PayPal recibido",
  },
  wallet_full_payment_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR,
    descripcion: "Pago completo vía billetera",
  },

  // ── Penalidad de cancelación (ingreso distinto a servicio) ─────────
  cancellation_penalty: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_PENALIDADES,
    descripcion: "Penalidad por cancelación",
  },

  // ── Reembolsos (dinero sale de la empresa) ──────────────────────────
  paypal_refund: {
    cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Reembolso vía PayPal",
  },
  warranty_refund: {
    cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Reembolso por garantía",
  },
  wallet_refund: {
    cuenta_debito: CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Reembolso a billetera",
  },

  // ── Holds (informativos — no mueven efectivo real, pero se registran) ─
  hold_authorized: {
    cuenta_debito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS,
    cuenta_credito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES,
    descripcion: "Hold autorizado — fondos retenidos por procesador",
  },
  hold_released: {
    cuenta_debito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES,
    cuenta_credito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS,
    descripcion: "Hold liberado — fondos devueltos al cliente",
  },
  capture_failed: {
    cuenta_debito: CHART_OF_ACCOUNTS.DEPOSITOS_CONTINGENTES,
    cuenta_credito: CHART_OF_ACCOUNTS.FONDOS_RETENIDOS,
    descripcion: "Captura fallida — hold no convertido",
  },

  // ── Capa 5: Tax Engine ────────────────────────────────────────────
  tax_gst_accrual: {
    cuenta_debito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010,
    cuenta_credito: CHART_OF_ACCOUNTS.GST_PAYABLE,
    descripcion: "Devengo GST — ingreso del periodo contra GST por pagar",
  },
  tax_pst_accrual: {
    cuenta_debito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010,
    cuenta_credito: CHART_OF_ACCOUNTS.PST_PAYABLE,
    descripcion: "Devengo PST — ingreso del periodo contra PST por pagar",
  },

  // ── Capa 7: AR B2B ────────────────────────────────────────────────
  ar_invoice_generated: {
    cuenta_debito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR_AR,
    cuenta_credito: CHART_OF_ACCOUNTS.INGRESOS_SERVICIOS_4010,
    descripcion: "Factura B2B emitida — devengo de ingreso por servicios",
  },
  ar_payment_received: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR_AR,
    descripcion: "Cobro de factura B2B — efectivo recibido contra AR",
  },

  // ── Capa 7: Bank Reconciliation ───────────────────────────────────
  bank_reconciled: {
    cuenta_debito: CHART_OF_ACCOUNTS.EFECTIVO,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Conciliación bancaria — match confirmado (no afecta saldo neto)",
  },
  payroll_disbursement: {
    cuenta_debito: CHART_OF_ACCOUNTS.NOMINA,
    cuenta_credito: CHART_OF_ACCOUNTS.EFECTIVO,
    descripcion: "Pago de nómina — desembolso de salarios",
  },
};

// =========================================================================
// generateJournalEntry — función principal
// =========================================================================

/**
 * Genera un asiento contable de partida doble a partir de un evento de
 * negocio.
 *
 * Cada llamada produce al menos 2 filas (una débito, una crédito) que
 * comparten el mismo `ledger_id` y suman el mismo monto. Esto garantiza
 * la ecuación contable fundamental: ACTIVO = PASIVO + PATRIMONIO.
 *
 * La función es pura: no toca la base de datos. El caller es responsable
 * de insertar las filas devueltas en `financial_ledger` dentro de la misma
 * transacción DB que originó el evento.
 *
 * @param event — Evento de negocio validado contra BusinessEventSchema
 * @returns Array de JournalEntryRow (mínimo 2: débito + crédito)
 * @throws {Error} si el evento no tiene un mapping contable definido
 */
export function generateJournalEntry(event: BusinessEvent): JournalEntryRow[] {
  // 1. Validar entrada con Zod
  const parsed = BusinessEventSchema.parse(event);

  // 2. Obtener mapping contable del evento
  const mapping = EVENT_ACCOUNT_MAP[parsed.event_type];
  if (!mapping) {
    throw new Error(
      `generateJournalEntry: no hay mapping contable para event_type=${parsed.event_type}`
    );
  }

  // 3. Derivar campos comunes
  const ledgerId = crypto.randomUUID();
  const timestamp = toISOString(parsed.occurred_at);
  const periodo = toPeriodoContable(timestamp);
  const monto = parsed.amount_cents;
  const createdBy = parsed.user_id ?? "system";
  const descripcionBase = mapping.descripcion;

  const referencia: Record<string, unknown> = {
    order_id: parsed.order_id,
    user_id: parsed.user_id,
    processor: parsed.processor,
    external_reference: parsed.external_reference,
    currency: parsed.currency,
    ...(parsed.metadata ?? {}),
  };

  // 4. Construir las dos filas (débito y crédito)
  const rows: Omit<JournalEntryRow, "hash_sha256">[] = [];

  // Fila DÉBITO
  if (mapping.cuenta_debito) {
    rows.push({
      ledger_id: ledgerId,
      event_id: parsed.event_id,
      event_type: parsed.event_type,
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: mapping.cuenta_debito,
      cuenta_credito: null,
      monto,
      moneda: "CAD",
      descripcion: `${descripcionBase} [DÉBITO] — ${parsed.order_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado",
      creado_por: createdBy,
    });
  }

  // Fila CRÉDITO
  if (mapping.cuenta_credito) {
    rows.push({
      ledger_id: ledgerId,
      event_id: parsed.event_id,
      event_type: parsed.event_type,
      timestamp,
      periodo_contable: periodo,
      cuenta_debito: null,
      cuenta_credito: mapping.cuenta_credito,
      monto,
      moneda: "CAD",
      descripcion: `${descripcionBase} [CRÉDITO] — ${parsed.order_id ?? "sin orden"}`,
      referencia,
      estado: "confirmado",
      creado_por: createdBy,
    });
  }

  // 5. Invariante: debe haber al menos 2 filas (una débito, una crédito)
  if (rows.length < 2) {
    throw new Error(
      `generateJournalEntry: invariante rota — se esperaban ≥2 filas, se generaron ${rows.length}. ` +
        `event_type=${parsed.event_type}, cuenta_debito=${mapping.cuenta_debito}, cuenta_credito=${mapping.cuenta_credito}`
    );
  }

  // 6. Invariante: la suma de montos en filas con débito debe igualar la suma en filas con crédito
  const sumDebito = rows
    .filter((r) => r.cuenta_debito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  const sumCredito = rows
    .filter((r) => r.cuenta_credito !== null)
    .reduce((sum, r) => sum + r.monto, 0);
  if (sumDebito !== sumCredito) {
    throw new Error(
      `generateJournalEntry: invariante contable rota — SUM(débito)=${sumDebito} ≠ SUM(crédito)=${sumCredito}. ` +
        `ledger_id=${ledgerId}, event_type=${parsed.event_type}`
    );
  }

  // 7. Calcular hash SHA-256 de cada fila y devolver con Zod validation
  return rows.map((row) => {
    const hash = computeRowHash(row);
    return JournalEntryRowSchema.parse({ ...row, hash_sha256: hash });
  });
}

// =========================================================================
// replayOrderBalance — reconstruye saldo desde financial_ledger
// =========================================================================

/**
 * Fila del ledger necesaria para reconstruir el balance de una orden.
 * Solo se necesitan los campos de cuenta y monto; el caller ya filtró
 * por order_id y estado a nivel de base de datos.
 */
export interface FinancialLedgerEntryForReplay {
  cuenta_debito: CuentaContable | null;
  cuenta_credito: CuentaContable | null;
  monto: number;
}

/**
 * Balance reconstruido de una orden desde el Financial Ledger.
 */
export interface ReplayedOrderBalance {
  /** Total cobrado (débitos a Efectivo desde Cuentas por Cobrar). */
  totalCollectedCents: number;
  /** Total reembolsado (créditos a Efectivo hacia Reembolsos Emitidos). */
  totalRefundedCents: number;
  /** Cobrado - Reembolsado. Representa el efectivo neto que dejó la orden. */
  netCents: number;
}

/**
 * Reconstruye el saldo financiero de una orden a partir de sus filas en el
 * Financial Ledger (partida doble).
 *
 * A diferencia de shadow-ledger.ts, aquí no se depende de `event_type` para
 * saber si un monto es cobro o reembolso — se usa la estructura contable:
 *
 * - Cobro: fila donde `cuenta_debito = EFECTIVO` (1-1000) y la contrapartida
 *   no es un reembolso (es decir, el crédito viene de CUENTAS_POR_COBRAR o
 *   INGRESOS_PENALIDADES).
 * - Reembolso: fila donde `cuenta_credito = EFECTIVO` (1-1000) y el débito
 *   viene de REEMBOLSOS_EMITIDOS.
 *
 * Las filas de holds (FONDOS_RETENIDOS ↔ DEPOSITOS_CONTINGENTES) se netean
 * a cero y no afectan el balance de caja.
 *
 * @param entries — Filas del financial_ledger filtradas por order_id.
 * @returns Balance neto (cobrado - reembolsado) en centavos.
 */
export function replayOrderBalance(
  entries: FinancialLedgerEntryForReplay[]
): ReplayedOrderBalance {
  let totalCollectedCents = 0;
  let totalRefundedCents = 0;

  for (const entry of entries) {
    // COBRO: débito a EFECTIVO (1-1000), crédito desde CUENTAS_POR_COBRAR o INGRESOS_PENALIDADES
    if (
      entry.cuenta_debito === CHART_OF_ACCOUNTS.EFECTIVO &&
      (entry.cuenta_credito === CHART_OF_ACCOUNTS.CUENTAS_POR_COBRAR ||
        entry.cuenta_credito === CHART_OF_ACCOUNTS.INGRESOS_PENALIDADES)
    ) {
      totalCollectedCents += entry.monto;
      continue;
    }

    // REEMBOLSO: crédito a EFECTIVO (1-1000), débito desde REEMBOLSOS_EMITIDOS
    if (
      entry.cuenta_credito === CHART_OF_ACCOUNTS.EFECTIVO &&
      entry.cuenta_debito === CHART_OF_ACCOUNTS.REEMBOLSOS_EMITIDOS
    ) {
      totalRefundedCents += entry.monto;
      continue;
    }

    // Holds: FONDOS_RETENIDOS ↔ DEPOSITOS_CONTINGENTES — se netean, no afectan caja
  }

  return {
    totalCollectedCents,
    totalRefundedCents,
    netCents: totalCollectedCents - totalRefundedCents,
  };
}

// =========================================================================
// SQL Schema — tabla financial_ledger + trigger de validación
// =========================================================================

/**
 * ─── MIGRACIÓN SQL (para `supabase db pull` o `supabase db query`) ───
 *
 * La tabla `financial_ledger` es la fuente de verdad contable. El trigger
 * `trg_validate_double_entry` corre en la misma transacción y fuerza
 * ROLLBACK si SUM(débitos) ≠ SUM(créditos) para algún ledger_id afectado
 * por el INSERT.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * CREATE TABLE IF NOT EXISTS financial_ledger (
 *   id            BIGSERIAL PRIMARY KEY,
 *   ledger_id     UUID NOT NULL,
 *   event_id      UUID NOT NULL,
 *   event_type    TEXT NOT NULL,
 *   "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   periodo_contable  TEXT NOT NULL CHECK (periodo_contable ~ '^\d{4}-\d{2}$'),
 *   cuenta_debito TEXT CHECK (cuenta_debito IN (
 *     '1-1000','1-1020','1-1100','1-1200','1-2025',
 *     '2-1000','2-2020','2-2030',
 *     '4-1000','4-2000','4-4010',
 *     '5-1000'
 *   )),
 *   cuenta_credito TEXT CHECK (cuenta_credito IN (
 *     '1-1000','1-1020','1-1100','1-1200','1-2025',
 *     '2-1000','2-2020','2-2030',
 *     '4-1000','4-2000','4-4010',
 *     '5-1000'
 *   )),
 *   monto          INTEGER NOT NULL CHECK (monto > 0),
 *   moneda         TEXT NOT NULL DEFAULT 'CAD' CHECK (moneda = 'CAD'),
 *   descripcion    TEXT NOT NULL DEFAULT '',
 *   referencia     JSONB NOT NULL DEFAULT '{}',
 *   estado         TEXT NOT NULL DEFAULT 'confirmado'
 *                    CHECK (estado IN ('confirmado','reversado','ajuste')),
 *   hash_sha256    TEXT NOT NULL CHECK (hash_sha256 ~ '^[a-f0-9]{64}$'),
 *   creado_por     TEXT NOT NULL DEFAULT 'system',
 *   created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
 *
 *   -- Restricción: CADA fila debe tener exactamente UN lado (débito XOR crédito)
 *   CONSTRAINT chk_one_side CHECK (
 *     (cuenta_debito IS NOT NULL AND cuenta_credito IS NULL) OR
 *     (cuenta_debito IS NULL AND cuenta_credito IS NOT NULL)
 *   )
 * );
 *
 * -- Índices
 * CREATE INDEX IF NOT EXISTS idx_financial_ledger_event_id ON financial_ledger(event_id);
 * CREATE INDEX IF NOT EXISTS idx_financial_ledger_periodo ON financial_ledger(periodo_contable);
 * CREATE INDEX IF NOT EXISTS idx_financial_ledger_event_type ON financial_ledger(event_type);
 *
 * -- Trigger de validación de partida doble
 * CREATE OR REPLACE FUNCTION fn_validate_double_entry()
 * RETURNS TRIGGER AS $$
 * DECLARE
 *   sum_debito  BIGINT;
 *   sum_credito BIGINT;
 * BEGIN
 *   -- Recalcular para TODOS los ledger_id afectados por el INSERT actual
 *   FOR sum_debito, sum_credito IN
 *     SELECT
 *       COALESCE(SUM(monto) FILTER (WHERE cuenta_debito IS NOT NULL), 0),
 *       COALESCE(SUM(monto) FILTER (WHERE cuenta_credito IS NOT NULL), 0)
 *     FROM financial_ledger
 *     WHERE ledger_id IN (SELECT DISTINCT ledger_id FROM inserted_rows())
 *     GROUP BY ledger_id
 *   LOOP
 *     IF sum_debito != sum_credito THEN
 *       RAISE EXCEPTION 'Partida doble inválida en ledger: débito=% crédito=%', sum_debito, sum_credito;
 *     END IF;
 *   END LOOP;
 *
 *   RETURN NULL; -- AFTER trigger, no modifica la fila
 * END;
 * $$ LANGUAGE plpgsql;
 *
 * CREATE OR REPLACE TRIGGER trg_validate_double_entry
 *   AFTER INSERT ON financial_ledger
 *   REFERENCING NEW TABLE AS inserted_rows
 *   FOR EACH STATEMENT
 *   EXECUTE FUNCTION fn_validate_double_entry();
 *
 * ═══════════════════════════════════════════════════════════════════════
 * -- NOTA: La validación corre AFTER INSERT … FOR EACH STATEMENT. Si la
 * -- suma no cuadra, el trigger lanza EXCEPTION y PostgreSQL hace ROLLBACK
 * -- de TODA la transacción. Esto garantiza atomicidad: o se escriben
 * -- todas las filas del asiento contable, o no se escribe ninguna.
 * ═══════════════════════════════════════════════════════════════════════
 */

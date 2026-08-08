/**
 * Capa 0 — Ledger Domain Types & Zod Schemas.
 *
 * Responsabilidad única: definir los tipos de dominio y esquemas de
 * validación Zod para el Financial Ledger de partida doble. Este módulo
 * NO contiene lógica de negocio — solo contratos de tipos y validación.
 *
 * Tipos exportados:
 *  - BusinessEventType, PaymentProcessor
 *  - BusinessEvent, LedgerEntryStatus
 *  - JournalEntryRow (alias financiero de FinancialLedgerEntry)
 *
 * Schemas exportados:
 *  - BusinessEventSchema
 *  - JournalEntryRowSchema
 */

import { z } from "zod";
import type { CuentaContable } from "./chart-of-accounts";

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
  | "payroll_disbursement"
  // ── Client Module Billing Bridge ─────────────────────────────────────
  | "client_invoice_generated"
  | "client_payment_received";

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
  // Capa 4: Payroll Engine
  "payroll_disbursement",
  // ── Client Module Billing Bridge
  "client_invoice_generated",
  "client_payment_received",
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
  "1010",
  "1100",
  "1130",
  "2010",
  "4010",
  "4040",
  "4050",
  // ── Capas 5 & 7 ──
  "1020",
  "2025",
  "2020",
  "2030",
  "2080",
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

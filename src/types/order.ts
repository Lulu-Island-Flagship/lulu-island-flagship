// ─── Tipos: Orden y Cliente (Módulo 0) ────────────────────────
// Extraídos de src/types/index.ts — auditoría H1 (2026-08-06).

import type { WarrantyStatus } from "./billing";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Order {
  id: string;
  quoteId: string;
  userId: string;
  serviceDate: string; // ISO date
  serviceTime: string; // HH:MM
  serviceDatetime: string; // ISO datetime
  status: OrderStatus;
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  stripeSetupIntentId?: string;
  paymentOption: "card" | "paypal_first_time" | "alipay" | "wechat_pay";
  /** RAÍZ-3 (2026-07-21): orders.hold_amount_cents — centavos enteros, no dólares. */
  holdAmount: number;
  /** RAÍZ-3 (2026-07-21): orders.hold_authorized_amount_cents — centavos enteros, no dólares. */
  holdAuthorizedAmount: number;
  holdCapturedAt?: string;
  holdReleasedAt?: string;
  stripeHoldPaymentIntentId?: string;
  paypalTransactionId?: string;
  paypalPayerEmail?: string;
  paypalAdvanceAmount: number;
  warrantyStatus: WarrantyStatus;
  warrantyResolvedAt?: string;
  warrantyResolutionNotes?: string;
  /** RAÍZ-3 (2026-07-21): orders.wallet_amount_used_cents — centavos enteros, no dólares. */
  walletAmountUsed: number;
  /** RAÍZ-3 (2026-07-21): orders.card_amount_charged_cents — centavos enteros, no dólares. */
  cardAmountCharged: number;
  /** RAÍZ-3 (2026-07-21): orders.total_paid_cents — centavos enteros, no dólares. */
  totalPaid: number;
  /**
   * Auditoría 2026-07-30 (BUG CRÍTICO tipo Order desincronizado): columnas
   * de migración 241 (Alipay/WeChat Pay) — cobro 100% por adelantado vía
   * PaymentIntent, distinto del flujo Hold+Batch de card/paypal_first_time.
   * orders.wallet_payment_intent_id — TEXT nullable, NULL para card/paypal_first_time.
   */
  walletPaymentIntentId?: string | null;
  /** orders.wallet_amount_collected_cents — centavos enteros, NOT NULL DEFAULT 0. Monto real verificado contra Stripe en /api/stripe/confirm. */
  walletAmountCollected: number;
  /** orders.wallet_refunded_amount_cents — centavos enteros, NOT NULL DEFAULT 0. Suma de reembolsos ya emitidos contra walletPaymentIntentId. */
  walletRefundedAmount: number;
  /**
   * Migraciones 152/245 — pago fraccionado 50/50 (órdenes > $500). Metadata
   * auditable; el cobro real sigue el flujo Hold+Batch existente (ver
   * src/lib/installment-payment.ts).
   * orders.installment_plan_selected — BOOLEAN NOT NULL DEFAULT false.
   */
  installmentPlanSelected: boolean;
  /** orders.installment_first_amount_cents — centavos enteros, nullable. */
  installmentFirstAmount?: number | null;
  /** orders.installment_second_amount_cents — centavos enteros, nullable. */
  installmentSecondAmount?: number | null;
  /** orders.installment_second_due_at — ISO datetime, nullable. */
  installmentSecondDueAt?: string | null;
  /** orders.installment_second_captured_at — ISO datetime, nullable hasta que el cron cobre de verdad la segunda mitad. */
  installmentSecondCapturedAt?: string | null;
  /** orders.installment_second_payment_intent_id — TEXT nullable, PaymentIntent del cobro de la segunda mitad. */
  installmentSecondPaymentIntentId?: string | null;
  /** orders.installment_second_attempts — INTEGER NOT NULL DEFAULT 0. Reintentos fallidos del cobro de la segunda mitad. */
  installmentSecondAttempts: number;
  /** orders.installment_second_last_error — TEXT nullable. */
  installmentSecondLastError?: string | null;
  addressLat?: number;
  addressLng?: number;
  cancellationWindowHours: number;
  pipaAltRequiresAudit?: boolean;
  purchaseOrder?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientProfile {
  id: string;
  userId: string;
  score: number;
  servicesCount: number;
  disputesCount: number;
  noShowCount: number;
  accountType: "b2c" | "b2b" | "government";
  companyName?: string;
  paymentTerms?: string;
  consentPhotoMarketing: boolean;
  photoMarketingVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientReview {
  id: string;
  userId: string;
  orderId: string;
  rating: number;
  reviewText?: string;
  source: "sms" | "email" | "app" | "external";
  status: "pending" | "published" | "hidden" | "flagged";
  adminResponse?: string;
  adminRespondedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientReviewScoreHistory {
  id: string;
  clientProfileId: string;
  score: number;
  scoredAt: string;
  eventType: "review_received" | "dispute_opened" | "no_show" | "manual_adjustment" | "scoring_batch";
  eventReference?: string;
  descripcion: string;
}

export interface PricingRule {
  id: string;
  name: string;
  description?: string;
  conditionJson: Record<string, unknown>;
  actionType: "price_multiplier" | "price_add" | "price_set" | "block" | "flag_for_review";
  actionValue?: number;
  priority: number;
  maxApplicable: boolean;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuleAuditLog {
  id: string;
  ruleId?: string;
  previousRule?: Record<string, unknown>;
  newRule?: Record<string, unknown>;
  changedBy?: string;
  reason: string;
  createdAt: string;
}

export interface ClientProperty {
  id: string;
  clientProfileId: string;
  nickname?: string;
  address: string;
  zone: string;
  postalCode?: string;
  squareFeet?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Zone {
  id: string;
  name: string;
  surchargeAmount: number;
  isActive: boolean;
  createdAt: string;
}

export interface FeatureFlag {
  nombre: string;
  activo: boolean;
  modulo: string;
  descripcion: string;
}

export type { AppliedRule } from "@/lib/rules";

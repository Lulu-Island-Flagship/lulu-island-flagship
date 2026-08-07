// ─── Tipos: Facturación, Garantía, Contratos y Wallet (Módulo 2) ─
// Extraídos de src/types/index.ts — auditoría H1 (2026-08-06).

export type WarrantyStatus =
  | "none"
  | "open"
  | "resolved_client"
  | "resolved_lulu"
  | "escalated"
  | "dismissed";

export interface WarrantyClaim {
  id: string;
  orderId: string;
  userId: string;
  reason: string;
  description?: string;
  status: "open" | "resolved_client" | "resolved_lulu" | "escalated" | "dismissed";
  openedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNotes?: string;
  autoResolved: boolean;
  refundAmount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyPhotoEvidence {
  id: string;
  warrantyClaimId: string;
  serviceChecklistItemId?: string;
  photoUrl: string;
  photoType: "before" | "after" | "client";
  zone?: string;
  itemLabel?: string;
  createdAt: string;
}

export type ContractFrequency = "weekly" | "biweekly" | "monthly" | "quarterly";

export interface ServiceContract {
  id: string;
  userId: string;
  quoteId?: string;
  propertyId?: string;
  serviceSubtype: string;
  frequency: ContractFrequency;
  dayOfWeek: number;
  preferredTime?: string;
  basePrice: number;
  total: number;
  holdAmount: number;
  currency: string;
  status: "active" | "paused" | "cancelled" | "completed";
  startDate: string;
  endDate?: string;
  nextScheduledDate?: string;
  paymentOption: "card" | "paypal_first_time";
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractInstance {
  id: string;
  contractId: string;
  orderId?: string;
  quoteId?: string;
  scheduledDate: string;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "skipped";
  createdAt: string;
  updatedAt: string;
}

export interface QboExport {
  id: string;
  exportDate: string;
  status: "pending" | "exported" | "failed";
  fileUrl?: string;
  totalTransactions: number;
  totalGross: number;
  totalFees: number;
  totalNet: number;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QboExportLine {
  id: string;
  exportId: string;
  orderId?: string;
  paymentIntentId?: string;
  transactionType: "capture" | "refund" | "chargeback" | "fee";
  transactionDate: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  description?: string;
  qboReference?: string;
  createdAt: string;
}

export interface ChargebackReserve {
  id: string;
  orderId: string;
  paymentIntentId?: string;
  capturedAmount: number;
  reservePercentage: number;
  reserveAmount: number;
  releasedAmount: number;
  status: "held" | "partially_released" | "released" | "applied";
  releaseDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChargebackSettings {
  id: string;
  reservePercentage: number;
  reserveCapAmount?: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientWallet {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  userId: string;
  orderId?: string;
  type: "credit" | "debit" | "refund" | "promo" | "payout";
  amount: number;
  balanceAfter: number;
  description?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

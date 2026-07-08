import {
  QuoteData,
  Order,
  AppliedRule,
  WarrantyClaim,
  WarrantyPhotoEvidence,
  PayrollEntry,
  ServiceContract,
  ContractInstance,
  QboExport,
  QboExportLine,
  ChargebackReserve,
  ClientWallet,
  WalletTransaction,
} from "@/types";

/**
 * Mapea una fila de Supabase (snake_case) a QuoteData (camelCase).
 * Centralizado para evitar duplicación en ReservaPage, ConfirmacionPage, etc.
 */
export function mapQuoteFromSupabase(data: Record<string, unknown>): QuoteData {
  return {
    id: data.id as string,
    userId: data.user_id as string,
    serviceCategory: data.service_category as "home" | "commercial" | undefined,
    serviceSubtype: data.service_subtype as string,
    serviceType: data.service_type as "regular" | "deep" | "move_in_out" | "post_construction" | undefined,
    bedrooms: data.bedrooms as number,
    bathrooms: data.bathrooms as number,
    squareFeet: data.square_feet as number,
    petsCount: data.pets_count as number,
    petsType: data.pets_type as string,
    residents: data.residents as number,
    daysSinceCleaning: data.days_since_cleaning as number,
    address: data.address as string,
    zone: data.zone as string,
    postalCode: data.postal_code as string,
    dayOfWeek: data.day_of_week as number | undefined,
    isPreferredDay: data.is_preferred_day as boolean | undefined,
    basePrice: data.base_price as number,
    organicMultiplier: data.organic_multiplier as number,
    organicAdjustment: data.organic_adjustment as number,
    recencyMultiplier: data.recency_multiplier as number,
    recencyAdjustment: data.recency_adjustment as number,
    zoneSurcharge: data.zone_surcharge as number,
    logisticsSurcharge: data.logistics_surcharge as number,
    ruleAdjustment: (data.rule_adjustment as number) ?? 0,
    appliedRules: (data.applied_rules as AppliedRule[]) ?? [],
    subtotal: data.subtotal as number,
    gst: data.gst as number,
    pst: data.pst as number,
    total: data.total as number,
    holdAmount: data.hold_amount as number,
    estimatedLaborCost: (data.estimated_labor_cost as number) ?? 0,
    estimatedMarginContribution: (data.estimated_margin_contribution as number) ?? 0,
    adminReviewRequired: (data.admin_review_required as boolean) ?? false,
    adminReviewReason: data.admin_review_reason as string | undefined,
    priceFrozenUntil: data.price_frozen_until as string,
    status: data.status as "pending" | "reserved" | "expired",
    consentTc: data.consent_tc as boolean,
    consentPipa: data.consent_pipa as boolean,
    consentMarketing: data.consent_marketing as boolean,
    consentPhotoMarketing: (data.consent_photo_marketing as boolean) ?? false,
    pipaAltRequiresAudit: (data.pipa_alt_requires_audit as boolean) ?? false,
    purchaseOrder: (data.purchase_order as string) || undefined,
    tcVersion: (data.tc_version as string) ?? "v1.0",
    pipaVersion: (data.pipa_version as string) ?? "v1.0",
    marketingVersion: (data.marketing_version as string) ?? "v1.0",
    photoMarketingVersion: (data.photo_marketing_version as string) ?? "v1.0",
    consentIp: data.consent_ip as string | undefined,
    consentAcceptedAt: data.consent_accepted_at as string | undefined,
    clientScore: data.client_score as number,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

/**
 * Mapea una fila de Supabase (snake_case) a Order (camelCase).
 */
export function mapOrderFromSupabase(data: Record<string, unknown>): Order {
  return {
    id: data.id as string,
    quoteId: data.quote_id as string,
    userId: data.user_id as string,
    serviceDate: data.service_date as string,
    serviceTime: data.service_time as string,
    serviceDatetime: data.service_datetime as string,
    status: data.status as Order["status"],
    stripeCustomerId: data.stripe_customer_id as string | undefined,
    stripePaymentMethodId: data.stripe_payment_method_id as string | undefined,
    stripeSetupIntentId: data.stripe_setup_intent_id as string | undefined,
    paymentOption: data.payment_option as "card" | "paypal_first_time",
    paypalTransactionId: data.paypal_transaction_id as string | undefined,
    paypalPayerEmail: data.paypal_payer_email as string | undefined,
    paypalAdvanceAmount: (data.paypal_advance_amount as number) ?? 0,
    holdAmount: data.hold_amount as number,
    holdAuthorizedAmount: (data.hold_authorized_amount as number) ?? 0,
    holdCapturedAt: data.hold_captured_at as string | undefined,
    holdReleasedAt: data.hold_released_at as string | undefined,
    stripeHoldPaymentIntentId: data.stripe_hold_payment_intent_id as string | undefined,
    warrantyStatus:
      (data.warranty_status as WarrantyClaim["status"] | undefined) ?? "none",
    warrantyResolvedAt: data.warranty_resolved_at as string | undefined,
    warrantyResolutionNotes: data.warranty_resolution_notes as string | undefined,
    walletAmountUsed: (data.wallet_amount_used as number) ?? 0,
    cardAmountCharged: (data.card_amount_charged as number) ?? 0,
    totalPaid: (data.total_paid as number) ?? 0,
    addressLat: data.address_lat as number | undefined,
    addressLng: data.address_lng as number | undefined,
    cancellationWindowHours: data.cancellation_window_hours as number,
    pipaAltRequiresAudit: (data.pipa_alt_requires_audit as boolean) ?? false,
    purchaseOrder: (data.purchase_order as string) || undefined,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapWarrantyClaimFromSupabase(
  data: Record<string, unknown>
): WarrantyClaim {
  return {
    id: data.id as string,
    orderId: data.order_id as string,
    userId: data.user_id as string,
    reason: data.reason as string,
    description: data.description as string | undefined,
    status: data.status as WarrantyClaim["status"],
    openedAt: data.opened_at as string,
    resolvedAt: data.resolved_at as string | undefined,
    resolvedBy: data.resolved_by as string | undefined,
    resolutionNotes: data.resolution_notes as string | undefined,
    autoResolved: (data.auto_resolved as boolean) ?? false,
    refundAmount: (data.refund_amount as number) ?? 0,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapWarrantyPhotoEvidenceFromSupabase(
  data: Record<string, unknown>
): WarrantyPhotoEvidence {
  return {
    id: data.id as string,
    warrantyClaimId: data.warranty_claim_id as string,
    serviceChecklistItemId: data.service_checklist_item_id as string | undefined,
    photoUrl: data.photo_url as string,
    photoType: data.photo_type as WarrantyPhotoEvidence["photoType"],
    zone: data.zone as string | undefined,
    itemLabel: data.item_label as string | undefined,
    createdAt: data.created_at as string,
  };
}

export function mapPayrollEntryFromSupabase(
  data: Record<string, unknown>
): PayrollEntry {
  return {
    id: data.id as string,
    employeeId: data.employee_id as string,
    orderId: data.order_id as string,
    assignmentId: data.assignment_id as string | undefined,
    dayRate: data.day_rate as number,
    estimatedServiceMinutes: (data.estimated_service_minutes as number) ?? 480,
    reworkMinutes: (data.rework_minutes as number) ?? 0,
    qcScore: data.qc_score as number | undefined,
    baseAmount: data.base_amount as number,
    qcBonusAmount: (data.qc_bonus_amount as number) ?? 0,
    qcPenaltyAmount: (data.qc_penalty_amount as number) ?? 0,
    reworkPaidMinutes: (data.rework_paid_minutes as number) ?? 0,
    reworkAmount: (data.rework_amount as number) ?? 0,
    hourlyEquivalent: Number(data.hourly_equivalent ?? 0),
    minimumWageAdjustment: (data.minimum_wage_adjustment as number) ?? 0,
    grossAmount: data.gross_amount as number,
    status: data.status as PayrollEntry["status"],
    approvedBy: data.approved_by as string | undefined,
    approvedAt: data.approved_at as string | undefined,
    paidAt: data.paid_at as string | undefined,
    paymentReference: data.payment_reference as string | undefined,
    notes: data.notes as string | undefined,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapServiceContractFromSupabase(
  data: Record<string, unknown>
): ServiceContract {
  return {
    id: data.id as string,
    userId: data.user_id as string,
    quoteId: data.quote_id as string | undefined,
    propertyId: data.property_id as string | undefined,
    serviceSubtype: data.service_subtype as string,
    frequency: data.frequency as ServiceContract["frequency"],
    dayOfWeek: data.day_of_week as number,
    preferredTime: data.preferred_time as string | undefined,
    basePrice: data.base_price as number,
    total: data.total as number,
    holdAmount: data.hold_amount as number,
    currency: (data.currency as string) ?? "CAD",
    status: data.status as ServiceContract["status"],
    startDate: data.start_date as string,
    endDate: data.end_date as string | undefined,
    nextScheduledDate: data.next_scheduled_date as string | undefined,
    paymentOption: data.payment_option as ServiceContract["paymentOption"],
    stripeCustomerId: data.stripe_customer_id as string | undefined,
    stripePaymentMethodId: data.stripe_payment_method_id as string | undefined,
    notes: data.notes as string | undefined,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapContractInstanceFromSupabase(
  data: Record<string, unknown>
): ContractInstance {
  return {
    id: data.id as string,
    contractId: data.contract_id as string,
    orderId: data.order_id as string | undefined,
    quoteId: data.quote_id as string | undefined,
    scheduledDate: data.scheduled_date as string,
    status: data.status as ContractInstance["status"],
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapQboExportFromSupabase(
  data: Record<string, unknown>
): QboExport {
  return {
    id: data.id as string,
    exportDate: data.export_date as string,
    status: data.status as QboExport["status"],
    fileUrl: data.file_url as string | undefined,
    totalTransactions: (data.total_transactions as number) ?? 0,
    totalGross: (data.total_gross as number) ?? 0,
    totalFees: (data.total_fees as number) ?? 0,
    totalNet: (data.total_net as number) ?? 0,
    notes: data.notes as string | undefined,
    createdBy: data.created_by as string | undefined,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapQboExportLineFromSupabase(
  data: Record<string, unknown>
): QboExportLine {
  return {
    id: data.id as string,
    exportId: data.export_id as string,
    orderId: data.order_id as string | undefined,
    paymentIntentId: data.payment_intent_id as string | undefined,
    transactionType: data.transaction_type as QboExportLine["transactionType"],
    transactionDate: data.transaction_date as string,
    grossAmount: data.gross_amount as number,
    feeAmount: (data.fee_amount as number) ?? 0,
    netAmount: data.net_amount as number,
    description: data.description as string | undefined,
    qboReference: data.qbo_reference as string | undefined,
    createdAt: data.created_at as string,
  };
}

export function mapChargebackReserveFromSupabase(
  data: Record<string, unknown>
): ChargebackReserve {
  return {
    id: data.id as string,
    orderId: data.order_id as string,
    paymentIntentId: data.payment_intent_id as string | undefined,
    capturedAmount: data.captured_amount as number,
    reservePercentage: Number(data.reserve_percentage ?? 0),
    reserveAmount: data.reserve_amount as number,
    releasedAmount: (data.released_amount as number) ?? 0,
    status: data.status as ChargebackReserve["status"],
    releaseDate: data.release_date as string | undefined,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapClientWalletFromSupabase(
  data: Record<string, unknown>
): ClientWallet {
  return {
    id: data.id as string,
    userId: data.user_id as string,
    balance: (data.balance as number) ?? 0,
    currency: (data.currency as string) ?? "CAD",
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

export function mapWalletTransactionFromSupabase(
  data: Record<string, unknown>
): WalletTransaction {
  return {
    id: data.id as string,
    walletId: data.wallet_id as string,
    userId: data.user_id as string,
    orderId: data.order_id as string | undefined,
    type: data.type as WalletTransaction["type"],
    amount: data.amount as number,
    balanceAfter: data.balance_after as number,
    description: data.description as string | undefined,
    metadata: (data.metadata as Record<string, unknown>) ?? {},
    createdAt: data.created_at as string,
  };
}

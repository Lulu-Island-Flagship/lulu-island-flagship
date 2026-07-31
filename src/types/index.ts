import { ServiceType, ServiceCategory } from "@/lib/pricing";
import { AppliedRule } from "@/lib/rules";
export type { AppliedRule } from "@/lib/rules";

export interface QuoteInput {
  serviceCategory?: ServiceCategory;     // "home" | "commercial"
  serviceSubtype?: string;              // "first_time", "regular", "move_in_out", "office", "airbnb", "post_construction"
  serviceType?: ServiceType;              // interno: "regular", "deep", "move_in_out", "post_construction"
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  petsCount: number;
  petsType: string;
  residents: number;
  daysSinceCleaning: number;
  address: string;
  zone: string;
  postalCode: string;
  dayOfWeek?: number;
  isPreferredDay?: boolean;
  addressLat?: number;
  addressLng?: number;
  consentPhotoMarketing?: boolean;
  consentPipa?: boolean;
  purchaseOrder?: string;
  /** v8.3 M0-F0.4 (B.2.13): idiomas de la cuenta, ordenados por prioridad. */
  preferredLanguages?: string[];
  /** v8.3 E10 (D.10.2): "¿Cómo nos conociste?" — alimenta CAC/LTV por canal. */
  acquisitionChannel?: string;
  /** v8.3 E4 (D.7): códigos de zonas add-on (ej. "garage") seleccionadas por el cliente. */
  addonZones?: string[];
  /** v8.3 E6.6: factura impresa por correo, +$2 (B2C). B2B/Gov siempre true sin recargo. */
  printedInvoiceRequested?: boolean;
}

export interface QuoteData extends QuoteInput {
  id?: string;
  userId?: string;
  basePrice: number;
  organicMultiplier: number;
  organicAdjustment: number;
  recencyMultiplier: number;
  recencyAdjustment: number;
  zoneSurcharge: number;
  logisticsSurcharge: number;
  addonZonesCharge: number;
  ruleAdjustment: number;
  appliedRules: AppliedRule[];
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
  holdAmount: number;
  estimatedLaborCost: number;
  estimatedMarginContribution: number;
  adminReviewRequired: boolean;
  adminReviewReason?: string;
  priceFrozenUntil: string;
  status: "pending" | "reserved" | "expired";
  accountType?: "b2c" | "b2b" | "government";
  consentTc: boolean;
  consentPipa: boolean;
  consentMarketing: boolean;
  consentPhotoMarketing: boolean;
  pipaAltRequiresAudit?: boolean;
  purchaseOrder?: string;
  tcVersion: string;
  pipaVersion: string;
  marketingVersion: string;
  photoMarketingVersion: string;
  consentIp?: string;
  consentAcceptedAt?: string;
  clientScore: number;
  createdAt?: string;
  updatedAt?: string;
}

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

export type CotizadorStep =
  | "category"      // NUEVO: elegir Home / Commercial
  | "purpose"       // Subtipo específico
  | "dimensions"
  | "addonZones"    // v8.3 E4 (D.7): zonas add-on editables por el admin (ej. Garaje)
  | "organic"
  | "recency"
  | "address"
  | "summary";

export interface CotizadorState {
  step: CotizadorStep;
  stepIndex: number;
  input: Partial<QuoteInput>;
  quote?: QuoteData;
  priceFrozenUntil?: Date;
}

// ─── Módulo 3: Empleado ─────────────────────────────────────────────

export type EmployeeRole = "cleaner" | "supervisor" | "driver";
export type TrustLevel = "elite" | "standard" | "probation";

export interface Employee {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string;
  role: EmployeeRole;
  dayRate: number;          // $CAD — tarifa diaria (modelo 70/30)
  languages: string[];      // ej. ["en", "zh"]
  isActive: boolean;
  baseScheduleMinutes: number; // horario base (modelo 70/30)
  contingencyMinutes: number;  // contingencia (modelo 70/30)
  homeZone?: string;
  trustLevel: TrustLevel;
  vehicleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  isActive: boolean;
  currentLat?: number;
  currentLng?: number;
  lastLocationAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleTracking {
  id: string;
  vehicleId: string;
  lat: number;
  lng: number;
  recordedAt: string;
  source: "driver_app" | "gps_device" | "manual";
  metadata: Record<string, unknown>;
}

export type SlotType = "blocked" | "flexible" | "contingency";

export interface CapacitySlot {
  id: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  zone?: string;
  slotType: SlotType;
  maxTeams: number;
  committedTeams: number;
  blockedReason?: string;
  isPublished: boolean;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type DispatchRunPhase = "proposal" | "cutoff" | "published" | "simulation" | "crisis_fallback";

export interface DispatchRun {
  id: string;
  runDate: string;
  phase: DispatchRunPhase;
  triggeredAt: string;
  completedAt?: string;
  autoApproved: boolean;
  teamsAvailable: number;
  ordersProcessed: number;
  ordersAssigned: number;
  notes?: string;
  createdAt: string;
}

export type NoShowStatus = "waiting" | "recovered" | "unrecovered" | "cancelled";

export interface NoShowLog {
  id: string;
  orderId: string;
  employeeId?: string;
  detectedAt: string;
  graceUntil: string;
  recoveredAt?: string;
  recoveryAssignmentId?: string;
  clientNotifiedAt?: string;
  status: NoShowStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldAudit {
  id: string;
  orderId: string;
  employeeId: string;
  auditorId: string;
  score: number;
  criteria: Record<string, unknown>;
  notes?: string;
  photoUrl?: string;
  dispatchProbability: number;
  clientAnnounced: boolean;
  clientAnnouncedAt?: string;
  createdAt: string;
  appealedAt?: string;
  appealReason?: string;
  appealResolvedAt?: string;
}

export type AssignmentStatus =
  | "pending"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export interface Assignment {
  id: string;
  orderId: string;
  employeeId: string;
  assignedAt: string;
  status: AssignmentStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ServiceLogEvent =
  | "jornada_start"
  | "jornada_end"
  | "t_in"           // Llegada al sitio
  | "t_start"        // Inicio de limpieza
  | "t_out"          // Finalización
  | "photo"          // Foto subida
  | "note";          // Nota del empleado

export interface ServiceLog {
  id: string;
  orderId: string;
  employeeId: string;
  eventType: ServiceLogEvent;
  timestamp: string;
  locationLat?: number;
  locationLng?: number;
  photoUrl?: string;
  notes?: string;
  createdAt: string;
}

// Vista combinada para el empleado (assignment + order + quote)
export interface EmployeeService {
  assignmentId: string;
  orderId: string;
  status: AssignmentStatus;
  serviceDate: string;
  serviceTime: string;
  address: string;
  zone: string;
  serviceSubtype: string;
  squareFeet: number;
  bedrooms: number;
  bathrooms: number;
  petsCount: number;
  petsType: string;
  residents: number;
  notes?: string;
  clientName?: string;
  clientPhone?: string;
  addressLat?: number;
  addressLng?: number;
  /** v8.3 E6.6: cliente sin smartphone -- habilita pago alternativo con recibo firmado en el cierre. */
  noSmartphoneFlow?: boolean;
}

// ─── Módulo 4: Ejecución Física ───────────────────────────────────────

export interface SOPChecklistItem {
  id: string;
  label: string;
  required: boolean;
}

export interface SOPChecklist {
  id: string;
  serviceSubtype: string;
  zone: string;
  zoneLabel: string;
  zoneColor: string;
  zoneIcon: string;
  items: SOPChecklistItem[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceChecklistItem {
  id: string;
  orderId: string;
  employeeId: string;
  checklistId: string;
  itemId: string;
  itemLabel: string;
  isCompleted: boolean;
  completedAt?: string;
  photoUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceUpsell {
  id: string;
  orderId: string;
  employeeId: string;
  upsellType: string;
  upsellLabel: string;
  amount: number;
  clientApproved?: boolean;
  notes?: string;
  createdAt: string;
}

export interface ChecklistZoneProgress {
  checklistId: string;  // UUID de sop_checklists
  zone: string;
  zoneLabel: string;
  zoneColor: string;
  zoneIcon: string;
  totalItems: number;
  completedItems: number;
  requiredItems: number;
  requiredCompleted: number;
  items: {
    itemId: string;
    label: string;
    required: boolean;
    isCompleted: boolean;
    photoUrl?: string;
    notes?: string;
    /** v8.3 E4 (D.7): true en ítems de estufa/campana — sujetos al timer de superficie caliente. */
    hotSurface?: boolean;
    /** ISO timestamp de cuándo el empleado inició el timer de 10 min; null/undefined = no iniciado. */
    hotSurfaceTimerStartedAt?: string | null;
  }[];
}

// ─── Módulo 2: Viaje del Dinero y Garantía ────────────────────────────

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

export interface PayrollEntry {
  id: string;
  employeeId: string;
  orderId: string;
  assignmentId?: string;
  dayRate: number;
  estimatedServiceMinutes: number;
  reworkMinutes: number;
  qcScore?: number;
  baseAmount: number;
  qcBonusAmount: number;
  qcPenaltyAmount: number;
  reworkPaidMinutes: number;
  reworkAmount: number;
  hourlyEquivalent: number;
  minimumWageAdjustment: number;
  grossAmount: number;
  status: "pending" | "approved" | "paid" | "disputed" | "cancelled";
  approvedBy?: string;
  approvedAt?: string;
  paidAt?: string;
  paymentReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollSettings {
  id: string;
  bcMinWageHourly: number;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeWithPayroll extends Employee {
  minWageFloorEnabled: boolean;
  qcScoreThreshold: number;
  qcBonusPerPoint: number;
  maxReworkMinutes: number;
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
  status: "pending" | "exported" | "reconciled" | "failed";
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

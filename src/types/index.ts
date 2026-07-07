import { ServiceType, ServiceCategory } from "@/lib/pricing";

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
  subtotal: number;
  gst: number;
  pst: number;
  total: number;
  holdAmount: number;
  priceFrozenUntil: string;
  status: "pending" | "reserved" | "expired";
  consentTc: boolean;
  consentPipa: boolean;
  consentMarketing: boolean;
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
  paymentOption: "card" | "paypal_first_time";
  paypalTransactionId?: string;
  holdAmount: number;
  holdCapturedAt?: string;
  holdReleasedAt?: string;
  cancellationWindowHours: number;
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

export type CotizadorStep =
  | "category"      // NUEVO: elegir Home / Commercial
  | "purpose"       // Subtipo específico
  | "dimensions"
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
  createdAt: string;
  updatedAt: string;
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
  }[];
}

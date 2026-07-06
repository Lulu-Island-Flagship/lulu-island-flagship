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

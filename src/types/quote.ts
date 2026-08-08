// ─── Tipos: Cotizador (Módulo 0) ───────────────────────────────
// Extraídos de src/types/index.ts — auditoría H1 (2026-08-06).

import { ServiceType, ServiceCategory } from "@/lib/pricing";
import { AppliedRule } from "@/lib/rules";

export interface QuoteInput {
  serviceCategory?: ServiceCategory;     // "home" | "commercial"
  serviceSubtype?: string;              // "first_time", "regular", "move_in_out", "office", "airbnb", "post_construction"
  serviceType?: ServiceType;              // interno: "regular", "deep", "move_in_out", "post_construction"
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  /** Lo que el cliente declaró como área. Puede diferir de squareFeet.
   *  Se imprime en la factura; el precio SIEMPRE se calcula con squareFeet. */
  squareFeetDeclared?: number;
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

export type CotizadorStep =
  | "address"       // Cliente escribe su dirección
  | "verify"        // BC Assessment verifica; cliente confirma/edita
  | "purpose"       // Subtipo de servicio
  | "organic"       // Mascotas, residentes
  | "recency"       // Días desde última limpieza
  | "summary";      // Precio final y reservar

export interface CotizadorState {
  step: CotizadorStep;
  stepIndex: number;
  input: Partial<QuoteInput>;
  quote?: QuoteData;
  priceFrozenUntil?: Date;
}

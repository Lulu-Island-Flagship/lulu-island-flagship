// Módulo nuevo y separado: "Módulo de Cliente" (quien contrata el servicio
// de limpieza). Complementario al módulo de empleado (src/lib/hiring-flow/,
// que a pesar del nombre de carpeta contiene infraestructura genérica
// reutilizable) pero independiente de él: este módulo no importa nada
// específico de candidatos/empleados, solo la infraestructura genérica
// (settings-service, legal-text-service) como dependencia externa de solo
// lectura.
//
// Interfaces TS en camelCase, una por tabla. Las tablas están siendo
// creadas en paralelo por otro agente (migraciones nuevas) -- este archivo
// asume el contrato exacto descrito en la tarea, no crea ni stubea
// migraciones.

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

export type ClientType = "residential" | "commercial" | "industrial";

export type PreferredLanguage = "en" | "fr" | "es" | "zh";

export type ClientStatus =
  | "lead"
  | "onboarding"
  | "active"
  | "suspended"
  | "inactive"
  | "churned";

// Tabla: clients
export interface Client {
  id: string;
  clientType: ClientType;
  legalName: string;
  displayName: string | null;
  email: string;
  phonePrimary: string;
  phoneSecondary: string | null;
  preferredLanguage: PreferredLanguage;
  status: ClientStatus;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  gstNumber: string | null;
  pstExemptionNumber: string | null;
  invoiceTerms: string | null;
  referralSource: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// client_properties
// ---------------------------------------------------------------------------

export type PropertyType =
  | "house"
  | "condo"
  | "townhouse"
  | "office"
  | "retail"
  | "warehouse"
  | "construction_site";

export type PropertyStatus = "active" | "inactive";

// Tabla: client_properties
export interface ClientProperty {
  id: string;
  clientId: string;
  propertyName: string | null;
  propertyType: PropertyType;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  province: string;
  postalCode: string;
  geoLat: number | null;
  geoLng: number | null;
  accessInstructions: string | null;
  cleaningInstructions: string | null;
  sqFt: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  petsInfo: string | null;
  parkingInfo: string | null;
  onsiteContactName: string | null;
  onsiteContactPhone: string | null;
  restrictedHours: string | null;
  photosAllowed: boolean | null;
  status: PropertyStatus;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// property_services
// ---------------------------------------------------------------------------

export type ServiceType =
  | "regular_cleaning"
  | "deep_cleaning"
  | "move_in_out"
  | "post_construction"
  | "carpet_cleaning";

export type ServiceFrequency = "weekly" | "biweekly" | "monthly" | "one_time" | "custom";

export type RateType = "flat_fee" | "hourly" | "sq_ft";

export type PropertyServiceStatus = "active" | "paused" | "cancelled";

// 0 = Sunday ... 6 = Saturday (mismo criterio que DayOfWeek en
// hiring-flow/types.ts, no importado directamente para mantener este
// módulo independiente).
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Tabla: property_services
export interface PropertyService {
  id: string;
  propertyId: string;
  serviceType: ServiceType;
  frequency: ServiceFrequency;
  dayOfWeek: DayOfWeek | null;
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  estimatedDurationHours: number | null;
  rateType: RateType;
  rateAmountCents: number;
  assignedEmployeeId: string | null;
  status: PropertyServiceStatus;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// client_consents
// ---------------------------------------------------------------------------

export type ClientConsentType =
  | "service_agreement"
  | "pipa_consent"
  | "photo_consent"
  | "key_handling_policy"
  | "cancellation_policy"
  | "damage_liability";

// Tabla: client_consents
export interface ClientConsent {
  id: string;
  clientId: string;
  consentType: ClientConsentType;
  legalTextKey: string;
  legalTextVersion: string;
  legalTextId: string;
  accepted: boolean;
  ipAddress: string;
  userAgent: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Validadores puros de integridad (sin lógica de negocio)
// ---------------------------------------------------------------------------

// Regex razonable (no RFC5322 completo): local@domain con al menos un punto
// en el dominio. Mismo patrón que hiring-flow/step1-validator.ts, pero
// reimplementado aquí (no importado) para que este módulo sea independiente.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0) return false;
  return EMAIL_PATTERN.test(trimmed);
}

// Teléfono canadiense: acepta con o sin prefijo país "+1"/"1", y con
// separadores comunes (espacios, guiones, paréntesis, puntos). Tras quitar
// todo lo que no sea dígito y un eventual "1" inicial de país, deben quedar
// exactamente 10 dígitos (NPA-NXX-XXXX norteamericano). Reimplementado aquí
// (no importado de hiring-flow/step1-validator.ts) a propósito, para que
// este módulo sea independiente y no dependa de un archivo hermano privado.
const PHONE_DIGITS_PATTERN = /^\d{10}$/;

function cleanPhoneDigits(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return digitsOnly.slice(1);
  }
  return digitsOnly;
}

export function isValidCanadianPhone(phone: string): boolean {
  if (typeof phone !== "string") return false;
  if (phone.trim().length === 0) return false;
  return PHONE_DIGITS_PATTERN.test(cleanPhoneDigits(phone));
}

// Formato general de código postal canadiense: letra-dígito-letra espacio(?)
// dígito-letra-dígito, ej. "A1A 1A1" o "A1A1A1". Las letras D, F, I, O, Q, U
// nunca se usan en ningún código postal canadiense (regla postal oficial de
// Canada Post) y W/Z nunca aparecen como PRIMERA letra -- se aplican ambas
// restricciones aquí porque son parte del formato general, no de un prefijo
// específico de provincia.
//
// IMPORTANTE: esto SOLO valida el FORMATO general canadiense. BC
// típicamente empieza con "V", pero esta función NO verifica que el
// prefijo sea de BC específicamente -- eso requeriría una lista real de
// prefijos de "Forward Sortation Area" (FSA) por provincia, que no está
// incluida aquí. Un código postal con formato válido de otra provincia
// (ej. "M5V 2T6", Ontario) pasa esta validación igual que uno de BC.
const BC_POSTAL_CODE_PATTERN =
  /^[A-Za-z][0-9][A-Za-z]\s?[0-9][A-Za-z][0-9]$/;
const INVALID_POSTAL_LETTERS = /[DFIOQU]/i;

export function isValidBcPostalCode(postalCode: string): boolean {
  if (typeof postalCode !== "string") return false;
  const trimmed = postalCode.trim();
  if (!BC_POSTAL_CODE_PATTERN.test(trimmed)) return false;

  const lettersOnly = trimmed.replace(/[0-9\s]/g, "");
  if (INVALID_POSTAL_LETTERS.test(lettersOnly)) return false;

  // W y Z nunca son la primera letra de un código postal canadiense.
  const firstLetter = trimmed[0].toUpperCase();
  if (firstLetter === "W" || firstLetter === "Z") return false;

  return true;
}

// ---------------------------------------------------------------------------
// client_communications
// ---------------------------------------------------------------------------

export type CommunicationChannel = "sms" | "email";

export type CommunicationType =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "service_completed"
  | "invoice_sent"
  | "payment_receipt"
  | "marketing"
  | "general";

export type CommunicationStatus = "queued" | "sent" | "failed";

// Tabla: client_communications. Complementa (no reemplaza) client_consents
// -- ver client-communication-service.ts: esto es operacional (confirmaciones
// de cita, recordatorios, facturas enviadas, etc.), no legal.
export interface ClientCommunication {
  id: string;
  clientId: string;
  channel: CommunicationChannel;
  communicationType: CommunicationType;
  templateKey: string | null;
  subject: string | null;
  status: CommunicationStatus;
  sentAt: string | null;
  relatedInvoiceId: string | null;
  createdAt: string;
}

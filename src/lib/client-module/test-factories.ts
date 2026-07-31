// Módulo nuevo y separado: "Módulo de Cliente". Factories para generar
// datos VÁLIDOS falsos de cada entidad del modelo (types.ts), en memoria,
// sin tocar la DB. Mismo patrón de estilo que
// src/lib/hiring-flow/test-factories.ts: los defaults siempre pasan las
// validaciones de types.ts, y `overrides` se aplica siempre al final con
// spread para poder forzar cualquier campo (incluyendo valores inválidos
// para tests que prueban exactamente el caso inválido).

import type {
  Client,
  ClientConsent,
  ClientConsentType,
  ClientProperty,
  ClientStatus,
  ClientType,
  DayOfWeek,
  PropertyService,
  PropertyType,
  ServiceType,
} from "./types";

function makeId(): string {
  return crypto.randomUUID();
}

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

let sequenceCounter = 0;
function nextSequence(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

export function makeClient(overrides: Partial<Client> = {}): Client {
  const n = nextSequence();
  const now = isoNow();
  const clientType: ClientType = "residential";
  const status: ClientStatus = "lead";
  return {
    id: makeId(),
    clientType,
    legalName: `Cliente de prueba ${n}`,
    displayName: `Cliente ${n}`,
    email: `cliente.prueba.${n}@example.com`,
    phonePrimary: "6045550" + String(100 + (n % 900)).padStart(3, "0"),
    phoneSecondary: null,
    preferredLanguage: "en",
    status,
    billingAddressLine1: "123 Test Street",
    billingAddressLine2: null,
    billingCity: "Victoria",
    billingProvince: "BC",
    billingPostalCode: "V8W 1A1",
    billingCountry: "CA",
    gstNumber: null,
    pstExemptionNumber: null,
    invoiceTerms: "net_30",
    referralSource: "test-factories",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// client_properties
// ---------------------------------------------------------------------------

export function makeClientProperty(
  overrides: Partial<ClientProperty> = {}
): ClientProperty {
  const n = nextSequence();
  const now = isoNow();
  const propertyType: PropertyType = "house";
  return {
    id: makeId(),
    clientId: makeId(),
    propertyName: `Propiedad de prueba ${n}`,
    propertyType,
    addressLine1: `${100 + n} Test Avenue`,
    addressLine2: null,
    city: "Victoria",
    province: "BC",
    postalCode: "V8W 1A1",
    geoLat: 48.4284,
    geoLng: -123.3656,
    accessInstructions: "Lockbox code 1234",
    cleaningInstructions: "Standard cleaning, no special instructions",
    sqFt: 1500,
    bedrooms: 3,
    bathrooms: 2,
    petsInfo: "One friendly dog",
    parkingInfo: "Driveway available",
    onsiteContactName: null,
    onsiteContactPhone: null,
    restrictedHours: null,
    photosAllowed: true,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// property_services
// ---------------------------------------------------------------------------

export function makePropertyService(
  overrides: Partial<PropertyService> = {}
): PropertyService {
  const n = nextSequence();
  const now = isoNow();
  const dayOfWeek = (n % 7) as DayOfWeek;
  const serviceType: ServiceType = "regular_cleaning";
  return {
    id: makeId(),
    propertyId: makeId(),
    serviceType,
    frequency: "biweekly",
    dayOfWeek,
    preferredTimeStart: "09:00:00",
    preferredTimeEnd: "11:00:00",
    estimatedDurationHours: 2,
    rateType: "flat_fee",
    rateAmountCents: 12000,
    assignedEmployeeId: null,
    status: "active",
    startDate: "2026-08-01",
    endDate: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// client_consents
// ---------------------------------------------------------------------------

export function makeClientConsent(
  overrides: Partial<ClientConsent> = {}
): ClientConsent {
  const n = nextSequence();
  const consentType: ClientConsentType = "service_agreement";
  return {
    id: makeId(),
    clientId: makeId(),
    consentType,
    legalTextKey: "service-agreement",
    legalTextVersion: `v1.${n}`,
    legalTextId: makeId(),
    accepted: true,
    ipAddress: "203.0.113.20",
    userAgent: "Mozilla/5.0 (test-factories fake user agent)",
    createdAt: isoNow(),
    ...overrides,
  };
}

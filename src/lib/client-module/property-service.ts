import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "../hiring-flow/settings-service";
import {
  isValidBcPostalCode,
  type PropertyType,
  type ServiceType,
  type ServiceFrequency,
  type RateType,
  type DayOfWeek,
} from "./types";

// Módulo nuevo y separado: "Módulo de Cliente". Gestión de propiedades del
// cliente (client_module_properties) y de los servicios contratados sobre
// cada propiedad (property_services).
//
// [FIX 2026-07-31] Tabla renombrada de `client_properties` a
// `client_module_properties`: ya existía una tabla `client_properties`
// completamente distinta desde la migración 001 (Módulo 1, cotizador B2C),
// descubierto al intentar aplicar las migraciones a producción por primera
// vez. Ver comentario de cabecera de la migración 270 para el detalle
// completo.
//
// Tablas asumidas (otro agente las está creando en paralelo, contrato
// acordado, NO se crean ni se stubean aquí):
//   client_module_properties(id UUID, client_id UUID, property_name TEXT,
//     property_type TEXT, address_line1 TEXT, address_line2 TEXT,
//     city TEXT, province TEXT, postal_code TEXT, geo_lat NUMERIC,
//     geo_lng NUMERIC, access_instructions TEXT, cleaning_instructions TEXT,
//     sq_ft INTEGER, bedrooms SMALLINT, bathrooms NUMERIC, pets_info TEXT,
//     parking_info TEXT, onsite_contact_name TEXT, onsite_contact_phone TEXT,
//     restricted_hours TEXT, photos_allowed BOOLEAN, status TEXT,
//     created_at, updated_at)
//   property_services(id UUID, property_id UUID, service_type TEXT,
//     frequency TEXT, day_of_week SMALLINT, preferred_time_start TIME,
//     preferred_time_end TIME, estimated_duration_hours NUMERIC,
//     rate_type TEXT, rate_amount_cents INTEGER,
//     assigned_employee_id UUID NULL, status TEXT, start_date DATE,
//     end_date DATE, created_at, updated_at)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PropertiesClient = SupabaseClient<any, "public", any>;

function resolveClient(client?: PropertiesClient): PropertiesClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a client_module_properties / property_services"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// client_module_properties: validación + creación
// ---------------------------------------------------------------------------

const VALID_PROPERTY_TYPES: PropertyType[] = [
  "house",
  "condo",
  "townhouse",
  "office",
  "retail",
  "warehouse",
  "construction_site",
];

export interface CreatePropertyInput {
  propertyName?: string;
  propertyType: PropertyType;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  province: string;
  postalCode: string;
  geoLat?: number;
  geoLng?: number;
  accessInstructions?: string;
  cleaningInstructions?: string;
  sqFt?: number;
  bedrooms?: number;
  bathrooms?: number;
  petsInfo?: string;
  parkingInfo?: string;
  onsiteContactName?: string;
  onsiteContactPhone?: string;
  restrictedHours?: string;
  photosAllowed?: boolean;
}

export interface PropertyValidationError {
  field: string;
  message: string;
}

// Pura, acumula TODOS los errores (no fail-fast).
export function validatePropertyInput(
  input: CreatePropertyInput
): PropertyValidationError[] {
  const errors: PropertyValidationError[] = [];

  if (!input.propertyType || !VALID_PROPERTY_TYPES.includes(input.propertyType)) {
    errors.push({
      field: "propertyType",
      message: `propertyType must be one of: ${VALID_PROPERTY_TYPES.join(", ")}`,
    });
  }

  if (!input.addressLine1 || input.addressLine1.trim().length === 0) {
    errors.push({ field: "addressLine1", message: "addressLine1 is required" });
  }

  if (!input.city || input.city.trim().length === 0) {
    errors.push({ field: "city", message: "city is required" });
  }

  const postalCode = input.postalCode ?? "";
  if (postalCode.trim().length === 0) {
    errors.push({ field: "postalCode", message: "postalCode is required" });
  } else if (!isValidBcPostalCode(postalCode)) {
    errors.push({
      field: "postalCode",
      message: "postalCode must be a valid Canadian postal code (format A1A 1A1)",
    });
  }

  if (input.sqFt !== undefined && input.sqFt !== null && input.sqFt <= 0) {
    errors.push({ field: "sqFt", message: "sqFt must be greater than 0" });
  }

  if (input.bathrooms !== undefined && input.bathrooms !== null && input.bathrooms < 0) {
    errors.push({ field: "bathrooms", message: "bathrooms must be greater than or equal to 0" });
  }

  return errors;
}

export class PropertyValidationErrorSet extends Error {
  readonly validationErrors: PropertyValidationError[];

  constructor(validationErrors: PropertyValidationError[]) {
    const fields = validationErrors.map((e) => e.field).join(", ");
    super(`Property creation failed validation: ${fields}`);
    this.name = "PropertyValidationErrorSet";
    this.validationErrors = validationErrors;
  }
}

export async function createProperty(
  clientId: string,
  input: CreatePropertyInput,
  client?: PropertiesClient
): Promise<{ propertyId: string }> {
  const validationErrors = validatePropertyInput(input);
  if (validationErrors.length > 0) {
    throw new PropertyValidationErrorSet(validationErrors);
  }

  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("client_module_properties")
    .insert({
      client_id: clientId,
      property_name: input.propertyName ?? null,
      property_type: input.propertyType,
      address_line1: input.addressLine1.trim(),
      address_line2: input.addressLine2 ?? null,
      city: input.city.trim(),
      province: input.province,
      postal_code: input.postalCode,
      geo_lat: input.geoLat ?? null,
      geo_lng: input.geoLng ?? null,
      access_instructions: input.accessInstructions ?? null,
      cleaning_instructions: input.cleaningInstructions ?? null,
      sq_ft: input.sqFt ?? null,
      bedrooms: input.bedrooms ?? null,
      bathrooms: input.bathrooms ?? null,
      pets_info: input.petsInfo ?? null,
      parking_info: input.parkingInfo ?? null,
      onsite_contact_name: input.onsiteContactName ?? null,
      onsite_contact_phone: input.onsiteContactPhone ?? null,
      restricted_hours: input.restrictedHours ?? null,
      photos_allowed: input.photosAllowed ?? null,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert client_property for client "${clientId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { propertyId: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// property_services: validación + creación
// ---------------------------------------------------------------------------

const VALID_SERVICE_TYPES: ServiceType[] = [
  "regular_cleaning",
  "deep_cleaning",
  "move_in_out",
  "post_construction",
  "carpet_cleaning",
];
const VALID_FREQUENCIES: ServiceFrequency[] = [
  "weekly",
  "biweekly",
  "monthly",
  "one_time",
  "custom",
];
const VALID_RATE_TYPES: RateType[] = ["flat_fee", "hourly", "sq_ft"];

export interface AddPropertyServiceInput {
  serviceType: ServiceType;
  frequency: ServiceFrequency;
  dayOfWeek?: DayOfWeek;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  estimatedDurationHours?: number;
  rateType: RateType;
  rateAmountCents: number;
  assignedEmployeeId?: string;
  startDate: string;
  endDate?: string;
}

export interface PropertyServiceValidationError {
  field: string;
  message: string;
}

// Pura, acumula TODOS los errores (no fail-fast).
export function validatePropertyServiceInput(
  input: AddPropertyServiceInput
): PropertyServiceValidationError[] {
  const errors: PropertyServiceValidationError[] = [];

  if (!input.serviceType || !VALID_SERVICE_TYPES.includes(input.serviceType)) {
    errors.push({
      field: "serviceType",
      message: `serviceType must be one of: ${VALID_SERVICE_TYPES.join(", ")}`,
    });
  }

  if (!input.frequency || !VALID_FREQUENCIES.includes(input.frequency)) {
    errors.push({
      field: "frequency",
      message: `frequency must be one of: ${VALID_FREQUENCIES.join(", ")}`,
    });
  }

  if (!input.rateType || !VALID_RATE_TYPES.includes(input.rateType)) {
    errors.push({
      field: "rateType",
      message: `rateType must be one of: ${VALID_RATE_TYPES.join(", ")}`,
    });
  }

  if (
    input.estimatedDurationHours !== undefined &&
    input.estimatedDurationHours !== null &&
    input.estimatedDurationHours <= 0
  ) {
    errors.push({
      field: "estimatedDurationHours",
      message: "estimatedDurationHours must be greater than 0",
    });
  }

  if (input.rateAmountCents === undefined || input.rateAmountCents === null) {
    errors.push({ field: "rateAmountCents", message: "rateAmountCents is required" });
  } else if (input.rateAmountCents < 0) {
    errors.push({
      field: "rateAmountCents",
      message: "rateAmountCents must be greater than or equal to 0",
    });
  }

  if (!input.startDate || input.startDate.trim().length === 0) {
    errors.push({ field: "startDate", message: "startDate is required" });
  }

  if (input.endDate && input.startDate) {
    const start = new Date(`${input.startDate}T00:00:00Z`);
    const end = new Date(`${input.endDate}T00:00:00Z`);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
      errors.push({
        field: "endDate",
        message: "endDate must be on or after startDate",
      });
    }
  }

  return errors;
}

export class PropertyServiceValidationErrorSet extends Error {
  readonly validationErrors: PropertyServiceValidationError[];

  constructor(validationErrors: PropertyServiceValidationError[]) {
    const fields = validationErrors.map((e) => e.field).join(", ");
    super(`Property service creation failed validation: ${fields}`);
    this.name = "PropertyServiceValidationErrorSet";
    this.validationErrors = validationErrors;
  }
}

export async function addPropertyService(
  propertyId: string,
  input: AddPropertyServiceInput,
  client?: PropertiesClient
): Promise<{ propertyServiceId: string }> {
  const validationErrors = validatePropertyServiceInput(input);
  if (validationErrors.length > 0) {
    throw new PropertyServiceValidationErrorSet(validationErrors);
  }

  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("property_services")
    .insert({
      property_id: propertyId,
      service_type: input.serviceType,
      frequency: input.frequency,
      day_of_week: input.dayOfWeek ?? null,
      preferred_time_start: input.preferredTimeStart ?? null,
      preferred_time_end: input.preferredTimeEnd ?? null,
      estimated_duration_hours: input.estimatedDurationHours ?? null,
      rate_type: input.rateType,
      rate_amount_cents: input.rateAmountCents,
      assigned_employee_id: input.assignedEmployeeId ?? null,
      status: "active",
      start_date: input.startDate,
      end_date: input.endDate ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert property_service for property "${propertyId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { propertyServiceId: (data as { id: string }).id };
}

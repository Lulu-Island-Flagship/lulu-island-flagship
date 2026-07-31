import type { SupabaseClient } from "@supabase/supabase-js";
// getHiringFlowServiceClient() vive en el módulo hermano hiring-flow por
// razones históricas (fue la primera cosa que necesitó un cliente
// Supabase con SUPABASE_SERVICE_ROLE_KEY en este repo), pero es GENÉRICA:
// crea un cliente admin con la misma env var que usa cualquier módulo del
// sistema, no tiene nada específico de "hiring". Se importa tal cual, sin
// duplicarla ni envolverla.
import { getHiringFlowServiceClient } from "../hiring-flow/settings-service";
import {
  isValidEmail,
  isValidCanadianPhone,
  type Client,
  type ClientType,
  type ClientStatus,
  type PreferredLanguage,
} from "./types";
import { assertValidTransition } from "./client-lifecycle";

// Módulo nuevo y separado: "Módulo de Cliente" (quien contrata el servicio
// de limpieza). Complementario al módulo de empleado, pero independiente
// -- no importa nada específico de candidatos/empleados.
//
// Tabla asumida (otro agente la está creando en paralelo, contrato
// acordado, NO se crea ni se stubea aquí):
//   clients(id UUID, client_type TEXT, legal_name TEXT, display_name TEXT,
//     email TEXT, phone_primary TEXT, phone_secondary TEXT,
//     preferred_language TEXT, status TEXT, billing_address_line1 TEXT,
//     billing_address_line2 TEXT, billing_city TEXT, billing_province TEXT,
//     billing_postal_code TEXT, billing_country TEXT, gst_number TEXT,
//     pst_exemption_number TEXT, invoice_terms TEXT, referral_source TEXT,
//     created_at, updated_at)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientsClient = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// Input + validación
// ---------------------------------------------------------------------------

export interface CreateClientInput {
  clientType: ClientType;
  legalName: string;
  displayName?: string;
  email: string;
  phonePrimary: string;
  phoneSecondary?: string;
  preferredLanguage?: PreferredLanguage;
  referralSource?: string;
}

export interface ClientValidationError {
  field: string;
  message: string;
}

const VALID_CLIENT_TYPES: ClientType[] = ["residential", "commercial", "industrial"];
const VALID_LANGUAGES: PreferredLanguage[] = ["en", "fr", "es", "zh"];
const LEGAL_NAME_MIN_LENGTH = 2;
const LEGAL_NAME_MAX_LENGTH = 200;

// Pura, acumula TODOS los errores (no fail-fast) -- mismo patrón que
// hiring-flow/step1-validator.ts, reimplementado aquí para independencia.
export function validateCreateClientInput(
  input: CreateClientInput
): ClientValidationError[] {
  const errors: ClientValidationError[] = [];

  if (!input.clientType || !VALID_CLIENT_TYPES.includes(input.clientType)) {
    errors.push({
      field: "clientType",
      message: `clientType must be one of: ${VALID_CLIENT_TYPES.join(", ")}`,
    });
  }

  const legalName = (input.legalName ?? "").trim();
  if (legalName.length === 0) {
    errors.push({ field: "legalName", message: "legalName is required" });
  } else if (legalName.length < LEGAL_NAME_MIN_LENGTH) {
    errors.push({
      field: "legalName",
      message: `legalName must be at least ${LEGAL_NAME_MIN_LENGTH} characters`,
    });
  } else if (legalName.length > LEGAL_NAME_MAX_LENGTH) {
    errors.push({
      field: "legalName",
      message: `legalName must be at most ${LEGAL_NAME_MAX_LENGTH} characters`,
    });
  }

  const email = (input.email ?? "").trim();
  if (email.length === 0) {
    errors.push({ field: "email", message: "email is required" });
  } else if (!isValidEmail(email)) {
    errors.push({ field: "email", message: "email is not a valid email address" });
  }

  const phonePrimary = input.phonePrimary ?? "";
  if (phonePrimary.trim().length === 0) {
    errors.push({ field: "phonePrimary", message: "phonePrimary is required" });
  } else if (!isValidCanadianPhone(phonePrimary)) {
    errors.push({
      field: "phonePrimary",
      message: "phonePrimary must be a valid Canadian phone number",
    });
  }

  if (input.phoneSecondary && input.phoneSecondary.trim().length > 0) {
    if (!isValidCanadianPhone(input.phoneSecondary)) {
      errors.push({
        field: "phoneSecondary",
        message: "phoneSecondary must be a valid Canadian phone number",
      });
    }
  }

  if (input.preferredLanguage && !VALID_LANGUAGES.includes(input.preferredLanguage)) {
    errors.push({
      field: "preferredLanguage",
      message: `preferredLanguage must be one of: ${VALID_LANGUAGES.join(", ")}`,
    });
  }

  return errors;
}

// Envuelve el array de ClientValidationError en un tipo propio (en vez de
// lanzar el array directamente) para que el caller pueda hacer
// `err instanceof ClientCreationValidationError` de forma inequívoca y
// acceder a `.validationErrors`. Mismo patrón que
// hiring-flow/candidate-step1-service.ts (Step1SubmissionError).
export class ClientCreationValidationError extends Error {
  readonly validationErrors: ClientValidationError[];

  constructor(validationErrors: ClientValidationError[]) {
    const fields = validationErrors.map((e) => e.field).join(", ");
    super(`Client creation failed validation: ${fields}`);
    this.name = "ClientCreationValidationError";
    this.validationErrors = validationErrors;
  }
}

// ---------------------------------------------------------------------------
// Cliente Supabase
// ---------------------------------------------------------------------------

function resolveClient(client?: ClientsClient): ClientsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a clients"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// createClient
// ---------------------------------------------------------------------------

// Regla de negocio explícita: un cliente SIEMPRE nace como 'lead', nunca
// se crea directo en 'active' (o cualquier otro estado). El status no es
// parte de CreateClientInput a propósito -- no hay forma de que un caller
// lo fuerce a otra cosa al crear.
export async function createClient(
  input: CreateClientInput,
  client?: ClientsClient
): Promise<{ clientId: string }> {
  const validationErrors = validateCreateClientInput(input);
  if (validationErrors.length > 0) {
    throw new ClientCreationValidationError(validationErrors);
  }

  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("clients")
    .insert({
      client_type: input.clientType,
      legal_name: input.legalName.trim(),
      display_name: input.displayName ?? null,
      email: input.email.trim(),
      phone_primary: input.phonePrimary,
      phone_secondary: input.phoneSecondary ?? null,
      preferred_language: input.preferredLanguage ?? "en",
      referral_source: input.referralSource ?? null,
      status: "lead",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert client: ${error?.message ?? "no data returned"}`
    );
  }

  return { clientId: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// updateClientStatus
// ---------------------------------------------------------------------------

export async function updateClientStatus(
  clientId: string,
  newStatus: ClientStatus,
  client?: ClientsClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { data: currentRow, error: readError } = await resolved
    .from("clients")
    .select("status")
    .eq("id", clientId)
    .single();

  if (readError || !currentRow) {
    throw new Error(
      `Failed to read current status for client "${clientId}": ${
        readError?.message ?? "no data returned"
      }`
    );
  }

  const currentStatus = (currentRow as { status: ClientStatus }).status;

  // Lanza InvalidStatusTransitionError si la transición no está permitida
  // -- nunca se llega al UPDATE en ese caso.
  assertValidTransition(currentStatus, newStatus);

  const { error: updateError } = await resolved
    .from("clients")
    .update({ status: newStatus })
    .eq("id", clientId);

  if (updateError) {
    throw new Error(
      `Failed to update status for client "${clientId}": ${updateError.message}`
    );
  }
}

export type { Client };

import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "@/lib/supabase-service-client";
import {
  isValidEmail,
  isValidCanadianPhone,
  type Client,
  type ClientType,
  type ClientStatus,
  type PreferredLanguage,
} from "./types";
import { assertValidTransition } from "./client-lifecycle";
import { VALID_CLIENT_TYPES, VALID_LANGUAGES, LEGAL_NAME_MIN_LENGTH, LEGAL_NAME_MAX_LENGTH } from "@/lib/validation-constants";

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

// ---------------------------------------------------------------------------
// ensureClientForAuthUser
// ---------------------------------------------------------------------------

export interface EnsureClientForAuthUserInput {
  authUserId: string;
  email: string | null;
  phone: string | null;
}

// Código de error de Postgres para "unique_violation" -- ver
// https://www.postgresql.org/docs/current/errcodes-appendix.html. Se
// captura específicamente este código (no cualquier error del INSERT) para
// no enmascarar fallos reales (ej. columna inexistente, permisos) como si
// fueran el caso esperado de carrera concurrente.
const POSTGRES_UNIQUE_VIOLATION = "23505";

// Vincula un usuario ya autenticado (Supabase Auth -- Google/Apple OAuth,
// email OTP o phone OTP, todos vía AuthModal.tsx) con una fila de
// `clients`, creándola si todavía no existe. NO toca `client_profiles` (la
// tabla que ya usa el flujo de cotizador/checkout) -- este es un registro
// nuevo y paralelo pensado para el módulo de cliente (CRM) que se está
// construyendo ahora; unificar ambos es una decisión aparte, fuera de
// alcance aquí.
//
// legal_name / display_name: en el momento en que esta función corre (justo
// después del primer sign-in) no hay ningún dato de "nombre real" del
// cliente todavía -- ni siquiera un formulario que lo haya pedido. Se usa
// el email completo como placeholder (no solo la parte antes de la "@":
// partirlo ahí perdería información y podría producir un display_name poco
// reconocible para el cliente mismo, ej. "j.smith2019" en vez de su email
// completo, que al menos es inequívocamente "suyo"). Es intencionalmente un
// placeholder temporal hasta que exista un flujo de "completa tu perfil"
// que lo reemplace con el nombre real -- ese flujo no es parte de esta
// tarea.
//
// email / phone vacíos como "": Supabase Auth normalmente entrega EMAIL o
// PHONE (según el método de login usado: OAuth/email OTP dan email, phone
// OTP da phone), rara vez ambos ausentes a la vez -- pero el tipo de
// entrada permite que cualquiera de los dos sea null, así que se cubre el
// caso con "" en vez de forzar un valor inventado. clients.email/
// phone_primary no son NOT NULL con CHECK de formato a nivel de aplicación
// (ver validateCreateClientInput) porque ESTE flujo no pasa por esa
// validación -- viene directo de una identidad ya autenticada por Supabase,
// no de un formulario que un usuario pueda manipular libremente.
//
// Idempotencia: el SELECT inicial cubre el caso normal (llamadas repetidas
// del mismo usuario ya vinculado). Existe una ventana de carrera teórica
// entre el SELECT y el INSERT si dos requests concurrentes del MISMO
// usuario llegan en su primerísimo login (ej. dos tabs abiertas a la vez) --
// la red de seguridad real contra duplicados es el índice único parcial
// idx_clients_auth_user_id (migración 282): si ambos requests intentan
// INSERT, Postgres rechaza el segundo con 23505, y ese caso se captura
// explícitamente abajo para re-consultar y devolver la fila que sí se creó,
// en vez de propagar el error al caller.
export async function ensureClientForAuthUser(
  params: EnsureClientForAuthUserInput,
  client?: ClientsClient
): Promise<{ clientId: string; created: boolean }> {
  const resolved = resolveClient(client);

  const existing = await findClientByAuthUserId(resolved, params.authUserId);
  if (existing) {
    return { clientId: existing, created: false };
  }

  const email = params.email ?? "";
  const placeholderName = email.length > 0 ? email : "";

  const { data, error } = await resolved
    .from("clients")
    .insert({
      client_type: "residential",
      legal_name: placeholderName,
      display_name: placeholderName,
      email,
      phone_primary: params.phone ?? "",
      preferred_language: "en",
      status: "lead",
      auth_user_id: params.authUserId,
    })
    .select("id")
    .single();

  if (error) {
    // Carrera concurrente: otro request ya insertó la fila para este mismo
    // auth_user_id entre nuestro SELECT y este INSERT -- el índice único
    // parcial (282) rechazó el duplicado. No es un error real desde la
    // perspectiva del caller: se re-consulta y se devuelve la fila
    // ganadora en vez de propagar la excepción.
    if (
      (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    ) {
      const winner = await findClientByAuthUserId(resolved, params.authUserId);
      if (winner) {
        return { clientId: winner, created: false };
      }
    }
    throw new Error(
      `Failed to insert client for auth user "${params.authUserId}": ${error.message}`
    );
  }

  if (!data) {
    throw new Error(
      `Failed to insert client for auth user "${params.authUserId}": no data returned`
    );
  }

  return { clientId: (data as { id: string }).id, created: true };
}

async function findClientByAuthUserId(
  resolved: ClientsClient,
  authUserId: string
): Promise<string | null> {
  const { data, error } = await resolved
    .from("clients")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to look up client for auth user "${authUserId}": ${error.message}`
    );
  }

  return data ? (data as { id: string }).id : null;
}

export type { Client };

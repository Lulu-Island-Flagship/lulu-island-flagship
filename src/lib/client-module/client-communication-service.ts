import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "@/lib/supabase-service-client";
import type { ClientCommunication } from "./types";

// Módulo nuevo y separado: "Módulo de Cliente" -- Comunicaciones.
// Complementa (no reemplaza) client-consent-service.ts: los consentimientos
// son registros LEGALES de aceptación de un texto versionado; este servicio
// es puramente OPERACIONAL (confirmaciones de cita, recordatorios, avisos
// de factura, recibos de pago, marketing, mensajes generales).
//
// Tabla asumida (280, esta misma tarea):
//   client_communications(id UUID, client_id UUID, channel TEXT
//     CHECK IN ('sms','email'), communication_type TEXT CHECK IN
//     ('appointment_confirmation','appointment_reminder',
//     'service_completed','invoice_sent','payment_receipt','marketing',
//     'general'), template_key TEXT NULL, subject TEXT NULL, status TEXT
//     DEFAULT 'queued' CHECK IN ('queued','sent','failed'), sent_at
//     TIMESTAMPTZ NULL, related_invoice_id UUID NULL, created_at)
//
// Regla dura (mismo principio que hiring-flow/communications, 266): el
// envío real (llamar al proveedor de SMS/email) es responsabilidad de un
// worker/cola aparte, fuera de alcance de este archivo -- "usa cola de
// mensajes, no bloquees el HTTP response". queueCommunication() SIEMPRE
// inserta con status='queued', nunca 'sent': el estado 'sent' solo se
// alcanza vía markCommunicationSent(), llamado por el worker cuando el
// proveedor confirma la entrega.

type ClientCommunicationsClient = SupabaseClient;

export type CommunicationChannel = "sms" | "email";

export type CommunicationType =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "service_completed"
  | "invoice_sent"
  | "payment_receipt"
  | "marketing"
  | "general";

export interface QueueCommunicationInput {
  clientId: string;
  channel: CommunicationChannel;
  communicationType: CommunicationType;
  templateKey?: string;
  subject?: string;
  relatedInvoiceId?: string;
}

export class CommunicationValidationError extends Error {
  readonly validationErrors: string[];

  constructor(validationErrors: string[]) {
    super(`Communication validation failed: ${validationErrors.join("; ")}`);
    this.name = "CommunicationValidationError";
    this.validationErrors = validationErrors;
  }
}

const VALID_CHANNELS: CommunicationChannel[] = ["sms", "email"];

const VALID_COMMUNICATION_TYPES: CommunicationType[] = [
  "appointment_confirmation",
  "appointment_reminder",
  "service_completed",
  "invoice_sent",
  "payment_receipt",
  "marketing",
  "general",
];

// Pura, acumula TODOS los errores (no fail-fast) -- mismo patrón que
// client-service.ts / property-service.ts / payment-method-service.ts.
//
// Regla "email necesita subject o template_key": un mensaje channel='email'
// necesita algún origen para su asunto -- ya sea explícito (subject) o
// heredado de una plantilla resuelta más adelante en el pipeline de envío
// (template_key). Este validador NO resuelve la plantilla (no sabe con
// certeza si esa plantilla en particular define un subject válido), así
// que solo advierte cuando NINGUNO de los dos campos está presente -- es
// una validación de "al menos una fuente posible de asunto", no una
// garantía de que el asunto final será válido.
//
// Fix (auditoría 2026-07-31, hallazgo #2): la nota [ASSUMPTION] de abajo
// dejaba la validación de consentimiento de marketing (CASL, Canada's
// Anti-Spam Legislation) fuera de este archivo, delegada a "otra capa" que
// en la práctica no existía todavía -- el módulo de cliente (clients,
// 269) no tenía ningún campo de opt-in de marketing, así que no había
// ningún lugar real donde esa verificación pudiera vivir. Se agrega
// `clients.marketing_opt_in` (migración nueva, ver comentario en esa
// migración) y queueCommunication() ahora consulta ese campo y RECHAZA
// (lanza CommunicationValidationError, nunca inserta) cualquier
// communicationType='marketing' para un cliente sin opt-in vigente. Esto
// es distinto del sistema B2C legacy (client_profiles.marketing_opt_in,
// src/app/api/client/communication-preferences/route.ts) -- son dos
// módulos de cliente independientes con sus propias tablas (ver cabecera
// de este archivo), cada uno con su propio campo de opt-in.
export function validateQueueCommunicationInput(
  input: QueueCommunicationInput
): string[] {
  const errors: string[] = [];

  if (!input.clientId || input.clientId.trim().length === 0) {
    errors.push("clientId is required");
  }

  if (!input.channel || !VALID_CHANNELS.includes(input.channel)) {
    errors.push(`channel must be one of: ${VALID_CHANNELS.join(", ")}`);
  }

  if (
    !input.communicationType ||
    !VALID_COMMUNICATION_TYPES.includes(input.communicationType)
  ) {
    errors.push(
      `communicationType must be one of: ${VALID_COMMUNICATION_TYPES.join(", ")}`
    );
  }

  if (
    input.channel === "email" &&
    (!input.subject || input.subject.trim().length === 0) &&
    (!input.templateKey || input.templateKey.trim().length === 0)
  ) {
    errors.push(
      'channel "email" requires either subject or templateKey to be present'
    );
  }

  return errors;
}

function resolveClient(
  client?: ClientCommunicationsClient
): ClientCommunicationsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a client_communications"
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// queueCommunication
// ---------------------------------------------------------------------------
//
// SIEMPRE inserta con status='queued' -- nunca 'sent'. El envío real
// (llamada al proveedor SMS/email) es responsabilidad de un worker/cola
// aparte, fuera de alcance de este servicio.
export async function queueCommunication(
  input: QueueCommunicationInput,
  client?: ClientCommunicationsClient
): Promise<{ communicationId: string }> {
  const validationErrors = validateQueueCommunicationInput(input);
  if (validationErrors.length > 0) {
    throw new CommunicationValidationError(validationErrors);
  }

  const resolved = resolveClient(client);

  // CASL: un mensaje de marketing NUNCA se encola sin opt-in vigente --
  // ver nota de fix arriba. Se consulta clients.marketing_opt_in justo
  // antes del insert (misma transacción lógica que el resto de esta
  // función) en vez de confiar en que el caller ya lo validó.
  if (input.communicationType === "marketing") {
    const { data: clientRow, error: clientError } = await resolved
      .from("clients")
      .select("marketing_opt_in")
      .eq("id", input.clientId)
      .maybeSingle();

    if (clientError) {
      throw new Error(
        `Failed to verify marketing opt-in for client "${input.clientId}": ${clientError.message}`
      );
    }
    if (!clientRow || !clientRow.marketing_opt_in) {
      throw new CommunicationValidationError([
        `client "${input.clientId}" does not have an active marketing opt-in (CASL) -- cannot queue a marketing communication`,
      ]);
    }
  }

  const { data, error } = await resolved
    .from("client_communications")
    .insert({
      client_id: input.clientId,
      channel: input.channel,
      communication_type: input.communicationType,
      template_key: input.templateKey ?? null,
      subject: input.subject ?? null,
      status: "queued",
      related_invoice_id: input.relatedInvoiceId ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to insert client_communication for client "${input.clientId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { communicationId: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// markCommunicationSent / markCommunicationFailed
// ---------------------------------------------------------------------------
//
// Llamadas por el worker de envío tras confirmar el resultado con el
// proveedor de SMS/email -- nunca desde el request HTTP que encoló el
// mensaje.
export async function markCommunicationSent(
  communicationId: string,
  client?: ClientCommunicationsClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { error } = await resolved
    .from("client_communications")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", communicationId);

  if (error) {
    throw new Error(
      `Failed to mark client_communication "${communicationId}" as sent: ${error.message}`
    );
  }
}

export async function markCommunicationFailed(
  communicationId: string,
  client?: ClientCommunicationsClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { error } = await resolved
    .from("client_communications")
    .update({ status: "failed" })
    .eq("id", communicationId);

  if (error) {
    throw new Error(
      `Failed to mark client_communication "${communicationId}" as failed: ${error.message}`
    );
  }
}

// ---------------------------------------------------------------------------
// listClientCommunications
// ---------------------------------------------------------------------------
//
// Historial de comunicaciones de un cliente, más reciente primero -- misma
// consulta que respalda el índice (client_id, created_at) de la migración
// 280.
export async function listClientCommunications(
  clientId: string,
  client?: ClientCommunicationsClient
): Promise<ClientCommunication[]> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("client_communications")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to list client_communications for client "${clientId}": ${error.message}`
    );
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    clientId: row.client_id as string,
    channel: row.channel as CommunicationChannel,
    communicationType: row.communication_type as CommunicationType,
    templateKey: (row.template_key as string | null) ?? null,
    subject: (row.subject as string | null) ?? null,
    status: row.status as "queued" | "sent" | "failed",
    sentAt: (row.sent_at as string | null) ?? null,
    relatedInvoiceId: (row.related_invoice_id as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

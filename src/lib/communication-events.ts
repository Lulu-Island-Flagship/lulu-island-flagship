/**
 * v8.3 Capa 2 — Event bus de comunicación.
 *
 * Publica eventos de negocio en communication_events como cola de trabajo
 * para que el cron de procesamiento (src/app/api/cron/process-communication-events)
 * los consuma y despache mensajes vía send-communication.ts.
 *
 * Separa la emisión del evento (publishEvent, síncrono) del despacho real
 * (asíncrono vía cron) para no bloquear flujos de negocio críticos (reservas,
 * cierres de servicio, pagos) con latencia de canales externos (SMS/email).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = SupabaseClient<any, "public", any>;

export interface CommunicationEvent {
  id: string;
  event_type: string;
  business_object_type: string | null;
  business_object_id: string | null;
  payload: Record<string, unknown>;
  processed: boolean;
  created_at: string;
}

/**
 * Publica un evento de comunicación en la cola.
 * El cron de procesamiento lo consumirá después.
 */
export async function publishEvent(
  supabase: SupabaseAdmin,
  eventType: string,
  businessObjectType: string | null,
  businessObjectId: string | null,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("communication_events").insert({
    event_type: eventType,
    business_object_type: businessObjectType,
    business_object_id: businessObjectId,
    payload,
    processed: false,
  });

  if (error) {
    console.error("communication-events: publishEvent error", error);
    throw new Error(`Failed to publish event: ${error.message}`);
  }
}

/**
 * Obtiene eventos no procesados del tipo especificado, ordenados por
 * created_at ascendente (FIFO).
 */
export async function pollUnprocessedEvents(
  supabase: SupabaseAdmin,
  eventType: string
): Promise<CommunicationEvent[]> {
  const { data, error } = await supabase
    .from("communication_events")
    .select("id, event_type, business_object_type, business_object_id, payload, processed, created_at")
    .eq("event_type", eventType)
    .eq("processed", false)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("communication-events: pollUnprocessedEvents error", error);
    throw new Error(`Failed to poll events: ${error.message}`);
  }

  return (data ?? []) as CommunicationEvent[];
}

/**
 * Marca un evento como procesado.
 */
export async function markEventProcessed(
  supabase: SupabaseAdmin,
  eventId: string
): Promise<void> {
  const { error } = await supabase
    .from("communication_events")
    .update({ processed: true })
    .eq("id", eventId);

  if (error) {
    console.error("communication-events: markEventProcessed error", error);
    throw new Error(`Failed to mark event processed: ${error.message}`);
  }
}

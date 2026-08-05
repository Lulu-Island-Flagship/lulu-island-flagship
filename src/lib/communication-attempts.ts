import type { SupabaseClient } from "@supabase/supabase-js";

// Capa 0: Communication Observability — Library
// Funciones puras para registrar intentos de comunicación en la tabla
// communication_attempts sin depender de la lógica de negocio de cada módulo.

export interface CommunicationAttempt {
  emitterSystem: string;
  emitterUserId?: string | null;
  recipientId?: string | null;
  recipientType?: string | null;
  channel: "email" | "sms" | "chat" | "push";
  direction?: "inbound" | "outbound";
  businessObjectType?: string | null;
  businessObjectId?: string | null;
  status?: "pending" | "sent" | "failed" | "delivered";
  templateId?: string | null;
  contentHash?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Registra un intento de comunicación en la tabla espejo.
 * Best-effort: si falla, no interrumpe el flujo de negocio.
 */
export async function recordCommunicationAttempt(
  supabase: SupabaseClient,
  attempt: CommunicationAttempt
): Promise<void> {
  try {
    const { error } = await supabase.from("communication_attempts").insert({
      emitter_system: attempt.emitterSystem,
      emitter_user_id: attempt.emitterUserId || null,
      recipient_id: attempt.recipientId || null,
      recipient_type: attempt.recipientType || null,
      channel: attempt.channel,
      direction: attempt.direction || "outbound",
      business_object_type: attempt.businessObjectType || null,
      business_object_id: attempt.businessObjectId || null,
      status: attempt.status || "pending",
      template_id: attempt.templateId || null,
      content_hash: attempt.contentHash || null,
      error_message: attempt.errorMessage || null,
      metadata: attempt.metadata || null,
    });

    if (error) {
      console.warn(
        `[communication-attempts] Failed to record ${attempt.emitterSystem} ${attempt.channel} attempt:`,
        error.message
      );
    }
  } catch (err) {
    // Best-effort: nunca lanzar. La telemetría no debe romper el negocio.
    console.warn("[communication-attempts] Unexpected error recording attempt:", err);
  }
}

/**
 * Actualiza el estado de un intento existente.
 */
export async function updateCommunicationAttemptStatus(
  supabase: SupabaseClient,
  attemptId: string,
  status: "sent" | "failed" | "delivered",
  errorMessage?: string | null
): Promise<void> {
  try {
    await supabase
      .from("communication_attempts")
      .update({
        status,
        error_message: errorMessage || null,
      })
      .eq("id", attemptId);
  } catch (err) {
    console.warn("[communication-attempts] Failed to update attempt status:", err);
  }
}

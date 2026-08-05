/**
 * v8.4 Capa 3 — Notification Domain Service.
 *
 * Puente entre Capa 0 (communication_attempts, observabilidad) y Capa 3
 * (modelo canónico de comunicación). Este servicio orquesta el envío de
 * notificaciones por cualquier canal (sms/email/push), registrando cada
 * intento en communication_attempts y delegando el envío real al adaptador
 * correspondiente.
 *
 * A diferencia de dispatchCommunication (send-communication.ts), que está
 * acoplado al catálogo de eventos + plantillas + throttle de marketing,
 * sendNotification es una primitiva de más bajo nivel para módulos que ya
 * tienen su propia lógica de negocio y solo necesitan "enviar X por canal Y
 * y dejar rastro".
 *
 * Diseño: `sendNotification` nunca lanza. Siempre resuelve con
 * { success, attemptId? } para que el caller decida qué hacer con un fallo
 * de entrega sin que tumbe su flujo principal (reserva, cierre de servicio,
 * resolución de disputa, etc.).
 */

import { sendSms, type SendSmsResult } from "@/lib/sms";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import { recordCommunicationAttempt } from "@/lib/communication-attempts";
import { captureError } from "@/lib/observability";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SendNotificationParams {
  /** Canal por el que se envía la notificación. */
  channel: "email" | "sms" | "push";
  /** ID del destinatario (user_id o entidad destino). */
  recipientId: string;
  /** Tipo de destinatario (ej. "user", "employee", "client"). */
  recipientType?: string;
  /** Para canal email: dirección de correo del destinatario. */
  toEmail?: string;
  /** Para canal sms: número E.164 del destinatario. */
  phoneNumber?: string;
  /** Para canal push: device token (FCM/APNs). Sin adaptador real todavía. */
  deviceToken?: string;
  /** Asunto (solo relevante para email; sms/push lo ignoran). */
  subject?: string;
  /** Cuerpo ya renderizado (sin placeholders {var} pendientes). */
  body: string;
  /** Sistema emisor (ej. "payroll", "scheduling", "orders"). */
  emitterSystem: string;
  /** ID del usuario/empleado que originó la acción (opcional). */
  emitterUserId?: string | null;
  /** Tipo de objeto de negocio asociado (ej. "order", "shift", "payroll_run"). */
  businessObjectType?: string | null;
  /** ID del objeto de negocio asociado. */
  businessObjectId?: string | null;
  /** ID de plantilla (si se usó un template del catálogo communication_templates). */
  templateId?: string | null;
  /** Metadatos adicionales (jsonb en communication_attempts). */
  metadata?: Record<string, unknown> | null;
}

export interface SendNotificationResult {
  success: boolean;
  attemptId?: string;
}

/**
 * Envía una notificación por el canal especificado, registrando el intento
 * en communication_attempts (Capa 0). Es la primitiva de más bajo nivel para
 * módulos que ya tienen su propia lógica de negocio y solo necesitan
 * despachar un mensaje con trazabilidad.
 *
 * Nunca lanza: siempre resuelve con { success, attemptId? }.
 */
export async function sendNotification(
  supabase: SupabaseClient,
  params: SendNotificationParams
): Promise<SendNotificationResult> {
  // 1. Registrar el intento en Capa 0 (communication_attempts).
  const attemptId = await recordCommunicationAttempt(supabase, {
    emitterSystem: params.emitterSystem,
    emitterUserId: params.emitterUserId,
    recipientId: params.recipientId,
    recipientType: params.recipientType || null,
    channel: params.channel,
    direction: "outbound",
    businessObjectType: params.businessObjectType || null,
    businessObjectId: params.businessObjectId || null,
    status: "pending",
    templateId: params.templateId || null,
    metadata: params.metadata || null,
  });

  // 2. Despachar por el canal correspondiente.
  let sendResult: SendSmsResult | SendEmailResult | { status: string };

  switch (params.channel) {
    case "sms": {
      if (!params.phoneNumber) {
        captureError(new Error("sendNotification: sms channel requires phoneNumber"), {
          recipientId: params.recipientId,
          emitterSystem: params.emitterSystem,
        });
        return { success: false, attemptId: attemptId ?? undefined };
      }
      sendResult = await sendSms({
        phoneNumber: params.phoneNumber,
        body: params.body,
      });
      break;
    }

    case "email": {
      if (!params.toEmail) {
        captureError(new Error("sendNotification: email channel requires toEmail"), {
          recipientId: params.recipientId,
          emitterSystem: params.emitterSystem,
        });
        return { success: false, attemptId: attemptId ?? undefined };
      }
      sendResult = await sendEmail({
        toEmail: params.toEmail,
        subject: params.subject || "",
        body: params.body,
      });
      break;
    }

    case "push": {
      // Push no tiene adaptador real todavía (mismo criterio que whatsapp/call
      // en send-communication.ts: se registra como 'queued', no se finge
      // enviado). El caller recibe success:false y puede reintentar cuando
      // exista proveedor.
      captureError(new Error("sendNotification: push channel sin adaptador real"), {
        recipientId: params.recipientId,
        emitterSystem: params.emitterSystem,
        deviceToken: params.deviceToken ? "present" : "missing",
      });
      return { success: false, attemptId: attemptId ?? undefined };
    }

    default: {
      captureError(new Error(`sendNotification: canal desconocido '${(params as { channel: string }).channel}'`), {
        recipientId: params.recipientId,
        emitterSystem: params.emitterSystem,
      });
      return { success: false, attemptId: attemptId ?? undefined };
    }
  }

  // 3. Mapear el resultado del proveedor a éxito/fallo.
  const succeeded = sendResult.status === "sent" || sendResult.status === "queued";

  return {
    success: succeeded,
    attemptId: attemptId ?? undefined,
  };
}

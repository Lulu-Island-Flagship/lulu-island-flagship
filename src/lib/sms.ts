/**
 * v8.3 E2 — Interfaz de envío de SMS.
 *
 * Nació en E2.3 (D.10.9: reintento de cobro de las 10PM agotado → SMS con
 * link de actualización de pago) y se generaliza aquí (Sesión H, E6) para
 * que CUALQUIER evento del catálogo de comunicaciones (communication_events,
 * migración 045) pueda enviar por el mismo canal: confirmación de reserva,
 * confirmación de cierre de servicio, solicitud de reseña (B.2.18), aviso
 * de disputa/garantía resuelta, etc. `src/lib/send-communication.ts` es el
 * único llamador esperado de `sendSms` en producción; `sendPaymentUpdateSms`
 * se conserva como wrapper de compatibilidad para el cron de E2 existente.
 *
 * TODO(dueño/infra): no hay proveedor de SMS contratado todavía. Antes de
 * usar esto en producción, integrar un proveedor real (p.ej. Twilio,
 * MessageBird, AWS SNS) y setear las credenciales como variables de entorno
 * (nunca hardcodeadas). Esta función es la interfaz estable que el resto
 * del sistema debe llamar; solo cambia la implementación interna cuando
 * exista contrato con un proveedor.
 *
 * Mientras no haya proveedor configurado, sendSms() nunca intenta una
 * llamada de red: devuelve status "not_configured" de forma determinista
 * para que el caller pueda registrar el intento sin fallar silenciosamente
 * ni inventar una integración que no existe.
 */

export interface SendSmsInput {
  /** E.164, ej. +16045551234. Nunca se loguea completo (PIPA). */
  phoneNumber: string;
  /** Cuerpo ya renderizado (sin placeholders {var} pendientes). */
  body: string;
}

export interface SendSmsResult {
  status: "not_configured" | "queued" | "sent" | "failed";
  /** Número enmascarado, seguro para logs/DB (PIPA — nunca el teléfono completo). */
  maskedPhone: string;
  providerResponse: string | null;
}

export interface SendPaymentUpdateSmsInput {
  orderId: string;
  /** E.164, ej. +16045551234. Nunca se loguea completo (PIPA). */
  phoneNumber: string;
  /** Link de actualización de método de pago (ya generado por el caller). */
  paymentLink: string;
}

export type SendPaymentUpdateSmsResult = SendSmsResult;

export function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

/**
 * Interfaz estable de envío, genérica para cualquier evento del catálogo de
 * comunicaciones. Implementación real pendiente (ver TODO arriba). Nunca
 * lanza: siempre resuelve con un resultado explícito para que el caller
 * pueda registrar el intento (communication_log / payment_recovery_notifications)
 * sin condicionales especiales por proveedor faltante.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const maskedPhone = maskPhoneNumber(input.phoneNumber);

  // TODO(dueño/infra): reemplazar este bloque por la llamada real al
  // proveedor de SMS una vez exista contrato + credenciales. Ejemplo de
  // forma esperada (NO implementado, NO son credenciales reales):
  //
  //   const client = getSmsProviderClient();
  //   const response = await client.messages.send({
  //     to: input.phoneNumber,
  //     body: input.body,
  //   });
  //   return { status: "sent", maskedPhone, providerResponse: response.id };

  return {
    status: "not_configured",
    maskedPhone,
    providerResponse: null,
  };
}

/**
 * Wrapper de compatibilidad (E2.3 original). Nuevos llamadores deben usar
 * `sendSms` directamente o, mejor, `dispatchCommunication` en
 * src/lib/send-communication.ts para pasar por plantillas + throttle.
 */
export async function sendPaymentUpdateSms(
  input: SendPaymentUpdateSmsInput
): Promise<SendPaymentUpdateSmsResult> {
  return sendSms({
    phoneNumber: input.phoneNumber,
    body: `Su pago de la orden ${input.orderId} no se pudo procesar. Actualice su método de pago: ${input.paymentLink}`,
  });
}

/** Construye el link de actualización de pago para una orden. */
export function buildPaymentUpdateLink(orderId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/orders/${orderId}/update-payment`;
}

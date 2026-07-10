/**
 * v8.3 E2 — Interfaz de envío de SMS para recuperación de pago.
 *
 * Contexto (D.10.9 / E2.3): si el reintento de cobro de las 10PM agota los
 * MAX_ATTEMPTS, el cliente debe recibir un SMS con un link para actualizar
 * su método de pago.
 *
 * TODO(dueño/infra): no hay proveedor de SMS contratado todavía. Antes de
 * usar esto en producción, integrar un proveedor real (p.ej. Twilio,
 * MessageBird, AWS SNS) y setear las credenciales como variables de entorno
 * (nunca hardcodeadas). Esta función es la interfaz estable que el resto
 * del sistema debe llamar; solo cambia la implementación interna cuando
 * exista contrato con un proveedor.
 *
 * Mientras no haya proveedor configurado, sendPaymentUpdateSms() nunca
 * intenta una llamada de red: devuelve status "not_configured" de forma
 * determinista para que el caller pueda registrar el intento sin fallar
 * silenciosamente ni inventar una integración que no existe.
 */

export interface SendPaymentUpdateSmsInput {
  orderId: string;
  /** E.164, ej. +16045551234. Nunca se loguea completo (PIPA). */
  phoneNumber: string;
  /** Link de actualización de método de pago (ya generado por el caller). */
  paymentLink: string;
}

export interface SendPaymentUpdateSmsResult {
  status: "not_configured" | "queued" | "sent" | "failed";
  /** Número enmascarado, seguro para logs/DB (PIPA — nunca el teléfono completo). */
  maskedPhone: string;
  providerResponse: string | null;
}

export function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

/**
 * Interfaz estable de envío. Implementación real pendiente (ver TODO arriba).
 * Nunca lanza: siempre resuelve con un resultado explícito para que el cron
 * que la invoca pueda registrar el intento en payment_recovery_notifications
 * sin condicionales especiales por proveedor faltante.
 */
export async function sendPaymentUpdateSms(
  input: SendPaymentUpdateSmsInput
): Promise<SendPaymentUpdateSmsResult> {
  const maskedPhone = maskPhoneNumber(input.phoneNumber);

  // TODO(dueño/infra): reemplazar este bloque por la llamada real al
  // proveedor de SMS una vez exista contrato + credenciales. Ejemplo de
  // forma esperada (NO implementado, NO son credenciales reales):
  //
  //   const client = getSmsProviderClient();
  //   const response = await client.messages.send({
  //     to: input.phoneNumber,
  //     body: `Su pago de la orden ${input.orderId} no se pudo procesar. Actualice su método de pago: ${input.paymentLink}`,
  //   });
  //   return { status: "sent", maskedPhone, providerResponse: response.id };

  return {
    status: "not_configured",
    maskedPhone,
    providerResponse: null,
  };
}

/** Construye el link de actualización de pago para una orden. */
export function buildPaymentUpdateLink(orderId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/orders/${orderId}/update-payment`;
}

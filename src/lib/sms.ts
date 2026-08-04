import { captureError } from "@/lib/observability";

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
 *
 * v8.3 P0-2 (auditoría Fable5, 2026-07-19): `isSmsProviderConfigured()` es
 * la ÚNICA fuente de verdad de "¿existe un proveedor de SMS real?" en todo
 * el sistema. Antes de este fix, sendSms() no tenía ningún chequeo -- era
 * un stub incondicional. Se agrega este chequeo (TWILIO_ACCOUNT_SID +
 * TWILIO_AUTH_TOKEN, las variables estándar del SDK de Twilio) y sendSms()
 * lo reusa internamente para no duplicar la condición. `src/app/api/stripe/
 * confirm/route.ts` importa esta misma función para decidir si puede exigir
 * `client_profiles.phone_verified` (si no hay proveedor, Supabase Auth OTP
 * nunca puede entregar el código, así que exigir verificación sería exigir
 * algo estructuralmente imposible de cumplir -- ver P0-2 del informe).
 * Nota de diseño: la verificación telefónica real usa el proveedor SMS de
 * Supabase Auth (`supabase/config.toml` -> `[auth.sms.twilio]`), que es
 * técnicamente una integración distinta de este módulo (comunicaciones
 * salientes de la app, P0-3). En la práctica ambas dependen de la MISMA
 * cuenta de Twilio que el dueño debe contratar, así que se trata como una
 * sola fuente de verdad: si `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` no
 * están seteadas del lado servidor, se asume que ningún canal de SMS real
 * existe todavía (ni el de Auth OTP ni el de sendSms()).
 *
 * v8.3 B-3 (auditoría go-live 2026-07-20): sendSms() ya no es un stub -- se
 * implementa el envío real vía la API REST de Twilio (fetch nativo, sin
 * SDK). Requiere además `TWILIO_FROM_NUMBER` (número E.164 comprado en
 * Twilio); si falta, el envío se sigue tratando como "not_configured" en
 * vez de simular un éxito.
 */

/**
 * ¿Hay un proveedor de SMS real configurado? Chequeo puro sobre variables
 * de entorno de servidor -- nunca hace una llamada de red. Reusada por
 * sendSms() (abajo) y por cualquier flujo que necesite decidir si puede
 * exigir verificación telefónica (ver src/app/api/stripe/confirm/route.ts).
 */
export function isSmsProviderConfigured(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

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

  if (!isSmsProviderConfigured()) {
    return {
      status: "not_configured",
      maskedPhone,
      providerResponse: null,
    };
  }

  // v8.3 B-3 (auditoría go-live 2026-07-20): implementación real vía la API
  // REST de Twilio (fetch nativo, sin SDK adicional -- ver misma razón en
  // src/lib/email.ts). isSmsProviderConfigured() ya confirmó que
  // TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN existen; también se requiere
  // TWILIO_FROM_NUMBER (número de origen E.164 comprado en Twilio) -- si
  // falta, se trata como "not_configured" (mismo criterio: sin todos los
  // datos necesarios, no se simula un envío).
  const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
  const authToken = process.env.TWILIO_AUTH_TOKEN as string;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!fromNumber) {
    return {
      status: "not_configured",
      maskedPhone,
      providerResponse: null,
    };
  }

  try {
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: input.phoneNumber,
          From: fromNumber,
          Body: input.body,
        }),
      }
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      captureError(new Error(`Twilio send error: ${res.status}`), { twilioStatus: res.status, twilioBody: errBody });
      return { status: "failed", maskedPhone, providerResponse: null };
    }

    const data = (await res.json()) as { sid?: string };
    return { status: "sent", maskedPhone, providerResponse: data.sid ?? null };
  } catch (err) {
    captureError(err, { provider: "twilio", maskedPhone });
    return { status: "failed", maskedPhone, providerResponse: null };
  }
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

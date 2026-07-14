/**
 * v8.3 E6 — Interfaz de envío de Email.
 *
 * Mismo patrón exacto que src/lib/sms.ts (E2/E6): el catálogo de eventos de
 * comunicaciones (communication_events, migración 045) ya puede declarar
 * default_channel='email', pero hasta ahora `send-communication.ts` no tenía
 * ningún adaptador real para ese canal y lo dejaba en 'queued' de forma
 * permanente ("Canal 'email' sin adaptador real todavía (TODO E6)").
 *
 * TODO(dueño/infra): no hay proveedor de email contratado todavía. El stack
 * canónico (C.1) es SendGrid. Antes de usar esto en producción, integrar el
 * proveedor real y setear las credenciales como variables de entorno (nunca
 * hardcodeadas). Esta función es la interfaz estable que el resto del
 * sistema debe llamar; solo cambia la implementación interna cuando exista
 * contrato con un proveedor.
 *
 * Mientras no haya proveedor configurado, sendEmail() nunca intenta una
 * llamada de red: devuelve status "not_configured" de forma determinista,
 * igual que sendSms(), para que el caller pueda registrar el intento sin
 * fallar silenciosamente ni inventar una integración que no existe.
 */

export interface SendEmailInput {
  /** Nunca se loguea completo (PIPA) -- ver maskEmail. */
  toEmail: string;
  subject: string;
  /** Cuerpo ya renderizado (sin placeholders {var} pendientes). Texto plano; el proveedor real decide si lo envuelve en HTML. */
  body: string;
}

export interface SendEmailResult {
  status: "not_configured" | "queued" | "sent" | "failed";
  /** Email enmascarado, seguro para logs/DB (PIPA — nunca la dirección completa). */
  maskedEmail: string;
  providerResponse: string | null;
}

/** j***@example.com -- conserva solo la primera letra del local-part y el dominio completo (el dominio no es información personal identificable por sí solo). */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}***@${domain}`;
}

/**
 * Interfaz estable de envío, genérica para cualquier evento del catálogo de
 * comunicaciones con default_channel='email'. Implementación real pendiente
 * (ver TODO arriba). Nunca lanza: siempre resuelve con un resultado
 * explícito para que el caller pueda registrar el intento (communication_log)
 * sin condicionales especiales por proveedor faltante.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const maskedEmail = maskEmail(input.toEmail);

  // TODO(dueño/infra): reemplazar este bloque por la llamada real al
  // proveedor de email una vez exista contrato + credenciales. Ejemplo de
  // forma esperada (NO implementado, NO son credenciales reales):
  //
  //   const client = getEmailProviderClient(); // SendGrid
  //   const response = await client.send({
  //     to: input.toEmail,
  //     subject: input.subject,
  //     text: input.body,
  //   });
  //   return { status: "sent", maskedEmail, providerResponse: response.messageId };

  return {
    status: "not_configured",
    maskedEmail,
    providerResponse: null,
  };
}

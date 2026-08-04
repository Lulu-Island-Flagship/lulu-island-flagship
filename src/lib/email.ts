import { captureError } from "@/lib/observability";

/**
 * v8.3 E6 — Interfaz de envío de Email.
 *
 * Mismo patrón exacto que src/lib/sms.ts (E2/E6): el catálogo de eventos de
 * comunicaciones (communication_events, migración 045) ya puede declarar
 * default_channel='email', pero hasta ahora `send-communication.ts` no tenía
 * ningún adaptador real para ese canal y lo dejaba en 'queued' de forma
 * permanente ("Canal 'email' sin adaptador real todavía (TODO E6)").
 *
 * v8.3 B-3 (auditoría go-live 2026-07-20): sendEmail() era un stub
 * permanente que siempre devolvía "not_configured", incluso si alguien
 * seteaba credenciales. Se implementa un adaptador real con Resend
 * (https://resend.com/docs/api-reference/emails/send-email) vía fetch nativo
 * -- sin SDK adicional, para no tocar el lockfile mientras otros agentes
 * trabajan en paralelo en el mismo repo. El fallback "not_configured" sin
 * RESEND_API_KEY se conserva intacto (comportamiento correcto para dev/
 * staging sin proveedor contratado) -- este bloque solo se ejecuta si la
 * variable está seteada.
 *
 * Esta función es la interfaz estable que el resto del sistema debe llamar
 * (SendEmailInput/SendEmailResult sin cambios -- 8 archivos ya la consumen);
 * solo cambia la implementación interna.
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

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      status: "not_configured",
      maskedEmail,
      providerResponse: null,
    };
  }

  const from = process.env.EMAIL_FROM_ADDRESS || "Lulu Island Flagship <noreply@luluislandflagship.ca>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.toEmail],
        subject: input.subject,
        text: input.body,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      captureError(new Error(`Resend send error: ${res.status}`), { resendStatus: res.status, resendBody: errBody });
      return { status: "failed", maskedEmail, providerResponse: null };
    }

    const data = (await res.json()) as { id?: string };
    return { status: "sent", maskedEmail, providerResponse: data.id ?? null };
  } catch (err) {
    captureError(err, { provider: "resend", maskedEmail });
    return { status: "failed", maskedEmail, providerResponse: null };
  }
}

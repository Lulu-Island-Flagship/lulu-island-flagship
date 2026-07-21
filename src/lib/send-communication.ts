/**
 * v8.3 E6 — Motor de despacho de comunicaciones (Sesión H).
 *
 * El catálogo de eventos + plantillas (migración 045/057) y el árbitro de
 * throttle (renderTemplate/arbitrateThrottle en src/lib/communications.ts)
 * ya existían pero ningún punto real del sistema los invocaba. Este módulo
 * es el punto único de conexión: dado un event_key + destinatario + idioma
 * + variables, (1) busca la plantilla vigente, (2) la renderiza, (3) la
 * pasa por arbitrateThrottle, (4) si gana el arbitraje, envía por el canal
 * default del evento (hoy solo SMS tiene adaptador real, src/lib/sms.ts) y
 * (5) siempre deja rastro en communication_log (timeline de la orden).
 *
 * Diseño: `decideDispatch` es pura y testeable sin Supabase — concentra la
 * lógica de negocio (incluida la garantía de que arbitrateThrottle está
 * realmente en el camino). `dispatchCommunication` es el orquestador async
 * que hace I/O y llama a `decideDispatch`.
 */
import {
  renderTemplate,
  arbitrateThrottle,
  MissingVariableError,
  type ProposedMessage,
} from "./communications";
import { sendSms } from "./sms";
import { sendEmail } from "./email";
import { getVancouverTodayString, getVancouverOffset } from "./date-utils";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = SupabaseClient<any, "public", any>;

export interface CommunicationEventRow {
  event_key: string;
  category: "transactional" | "marketing";
  priority: "urgent" | "normal";
  default_channel: "sms" | "email" | "whatsapp" | "call";
  is_active: boolean;
}

export interface CommunicationTemplateRow {
  body: string;
  language: string;
  /** Solo relevante para el canal 'email'. Null en plantillas que solo se usan por SMS/WhatsApp. */
  subject?: string | null;
}

export interface DecideDispatchInput {
  event: CommunicationEventRow;
  template: CommunicationTemplateRow;
  vars: Record<string, string | number>;
  userId: string;
  eventKey: string;
  /** ¿este userId ya recibió un mensaje de marketing 'sent' esta semana ISO (Vancouver)? */
  marketingSentThisWeek: boolean;
  marketingWeight?: number;
}

export type DispatchDecision =
  | {
      action: "send";
      renderedBody: string;
      /** Renderizado igual que renderedBody (mismas vars) cuando el canal es 'email' y la plantilla trae subject. Null en cualquier otro caso. */
      renderedSubject: string | null;
      channel: CommunicationEventRow["default_channel"];
    }
  | { action: "postpone"; reason: string }
  | { action: "failed"; reason: string };

/**
 * Lógica pura: decide si un mensaje se envía, se pospone o falla. Reutiliza
 * arbitrateThrottle exactamente como está testeado en communications.test.ts
 * — no reimplementa la regla "un cliente nunca recibe trigger físico y
 * campaña la misma semana" (M13 F13.3 / D.4 E6).
 */
export function decideDispatch(input: DecideDispatchInput): DispatchDecision {
  if (!input.event.is_active) {
    return { action: "failed", reason: `Evento '${input.event.event_key}' está desactivado (feature flag / is_active=false)` };
  }

  let renderedBody: string;
  let renderedSubject: string | null = null;
  try {
    renderedBody = renderTemplate(input.template.body, input.vars);
    if (input.template.subject) {
      renderedSubject = renderTemplate(input.template.subject, input.vars);
    }
  } catch (e) {
    if (e instanceof MissingVariableError) {
      return { action: "failed", reason: e.message };
    }
    throw e;
  }

  const proposed: ProposedMessage = {
    id: `${input.userId}:${input.eventKey}`,
    userId: input.userId,
    eventKey: input.eventKey,
    category: input.event.category,
    priority: input.event.priority,
    marketingWeight: input.marketingWeight,
  };

  const marketingSentThisWeek = new Set<string>(
    input.marketingSentThisWeek ? [input.userId] : []
  );

  const { send, postponed } = arbitrateThrottle([proposed], marketingSentThisWeek);

  if (send.length === 1) {
    return { action: "send", renderedBody, renderedSubject, channel: input.event.default_channel };
  }

  return {
    action: "postpone",
    reason: postponed[0]?.reason ?? "Pospuesto por arbitraje de throttle (arbitrateThrottle)",
  };
}

/** Lunes 00:00 hora Vancouver de la semana ISO actual, como ISO string UTC. */
export function vancouverWeekStartIso(referenceDateStr?: string): string {
  const todayStr = referenceDateStr ?? getVancouverTodayString();
  const offset = getVancouverOffset(todayStr);
  const today = new Date(`${todayStr}T00:00:00${offset}`);
  const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay(); // 1=lunes ... 7=domingo
  const monday = new Date(today);
  monday.setUTCDate(monday.getUTCDate() - (isoDay - 1));
  return monday.toISOString();
}

export interface DispatchCommunicationParams {
  eventKey: string;
  userId: string;
  orderId?: string | null;
  language: "en" | "zh" | "fr";
  vars: Record<string, string | number>;
  marketingWeight?: number;
}

export type DispatchCommunicationStatus =
  | "sent"
  | "queued"
  | "postponed"
  | "failed"
  | "skipped_no_event"
  | "skipped_no_template";

export interface DispatchCommunicationResult {
  status: DispatchCommunicationStatus;
  detail?: string;
}

/**
 * Orquestador con I/O. Nunca lanza — cada estado (incluyendo errores) se
 * refleja en communication_log para que el timeline de la orden (E6.3) sea
 * completo, y para que el caller (rutas de API) pueda seguir su flujo
 * principal sin que un fallo de comunicaciones tumbe una reserva o un cierre
 * de servicio ya válidos.
 */
export async function dispatchCommunication(
  supabase: SupabaseAdmin,
  params: DispatchCommunicationParams
): Promise<DispatchCommunicationResult> {
  try {
    const { data: event } = await supabase
      .from("communication_events")
      .select("event_key, category, priority, default_channel, is_active")
      .eq("event_key", params.eventKey)
      .is("deleted_at", null)
      .maybeSingle();

    if (!event) {
      return { status: "skipped_no_event", detail: `Evento '${params.eventKey}' no está en el catálogo (communication_events)` };
    }

    let template: CommunicationTemplateRow | null = null;
    const { data: templateInLanguage } = await supabase
      .from("communication_templates")
      .select("body, language, subject")
      .eq("event_key", params.eventKey)
      .eq("language", params.language)
      .eq("is_current", true)
      .is("deleted_at", null)
      .maybeSingle();
    template = templateInLanguage ?? null;

    if (!template && params.language !== "en") {
      const { data: fallback } = await supabase
        .from("communication_templates")
        .select("body, language, subject")
        .eq("event_key", params.eventKey)
        .eq("language", "en")
        .eq("is_current", true)
        .is("deleted_at", null)
        .maybeSingle();
      template = fallback ?? null;
    }

    if (!template) {
      return { status: "skipped_no_template", detail: `Sin plantilla vigente para '${params.eventKey}' (ni en ${params.language} ni en en)` };
    }

    // v8.3 E6.5 (CASL): un evento de categoría 'marketing' SOLO se despacha
    // si la cuenta tiene marketing_opt_in=true HOY (client_profiles,
    // migración 154) -- distinto de quotes.consent_marketing, que es un
    // snapshot histórico. Transaccional nunca pasa por este gate (CASL: sin
    // opt-in requerido, ver comentario en communications.ts).
    let unsubscribeToken: string | null = null;
    if (event.category === "marketing") {
      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("marketing_opt_in, unsubscribe_token")
        .eq("user_id", params.userId)
        .maybeSingle();

      if (!clientProfile?.marketing_opt_in) {
        await supabase.from("communication_log").insert({
          order_id: params.orderId ?? null,
          user_id: params.userId,
          event_key: params.eventKey,
          category: event.category,
          channel: event.default_channel,
          language: params.language,
          body_rendered: "",
          status: "postponed",
          postponed_reason: "Cuenta sin marketing_opt_in=true (CASL) -- no se despacha",
        });
        return { status: "postponed", detail: "Cuenta no está opt-in a marketing (CASL)" };
      }
      unsubscribeToken = clientProfile.unsubscribe_token ?? null;
    }

    let marketingSentThisWeek = false;
    if (event.category === "marketing") {
      const weekStart = vancouverWeekStartIso();
      const { data: sentThisWeek } = await supabase
        .from("communication_log")
        .select("id")
        .eq("user_id", params.userId)
        .eq("category", "marketing")
        .eq("status", "sent")
        .gte("created_at", weekStart)
        .limit(1);
      marketingSentThisWeek = !!(sentThisWeek && sentThisWeek.length > 0);
    }

    // Toda plantilla de marketing debe poder usar {unsubscribe_link}
    // (CASL). Se inyecta aquí, no se exige que el caller lo pase -- así
    // ningún event_key nuevo de marketing puede "olvidarse" del link.
    const varsWithUnsubscribe =
      event.category === "marketing" && unsubscribeToken
        ? {
            ...params.vars,
            unsubscribe_link: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.luluisland.ca"}/api/communications/unsubscribe?token=${unsubscribeToken}`,
          }
        : params.vars;

    const decision = decideDispatch({
      event,
      template,
      vars: varsWithUnsubscribe,
      userId: params.userId,
      eventKey: params.eventKey,
      marketingSentThisWeek,
      marketingWeight: params.marketingWeight,
    });

    if (decision.action === "postpone") {
      await supabase.from("communication_log").insert({
        order_id: params.orderId ?? null,
        user_id: params.userId,
        event_key: params.eventKey,
        category: event.category,
        channel: event.default_channel,
        language: params.language,
        body_rendered: "",
        status: "postponed",
        postponed_reason: decision.reason,
      });
      return { status: "postponed", detail: decision.reason };
    }

    if (decision.action === "failed") {
      await supabase.from("communication_log").insert({
        order_id: params.orderId ?? null,
        user_id: params.userId,
        event_key: params.eventKey,
        category: event.category,
        channel: event.default_channel,
        language: params.language,
        body_rendered: "",
        status: "failed",
        postponed_reason: decision.reason,
      });
      return { status: "failed", detail: decision.reason };
    }

    // decision.action === "send"
    if (decision.channel === "whatsapp" || decision.channel === "call") {
      // WhatsApp/llamada quedan explícitamente pendientes — se registran
      // como 'queued', nunca se fingen enviados.
      await supabase.from("communication_log").insert({
        order_id: params.orderId ?? null,
        user_id: params.userId,
        event_key: params.eventKey,
        category: event.category,
        channel: decision.channel,
        language: params.language,
        body_rendered: decision.renderedBody,
        status: "queued",
        postponed_reason: `Canal '${decision.channel}' sin adaptador real todavía (TODO E6)`,
      });
      return { status: "queued", detail: `Canal '${decision.channel}' pendiente de adaptador` };
    }

    if (decision.channel === "email") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", params.userId)
        .maybeSingle();

      if (!profile?.email) {
        await supabase.from("communication_log").insert({
          order_id: params.orderId ?? null,
          user_id: params.userId,
          event_key: params.eventKey,
          category: event.category,
          channel: "email",
          language: params.language,
          body_rendered: decision.renderedBody,
          status: "queued",
          postponed_reason: "Cliente sin email registrado (profiles.email, migración 135)",
        });
        return { status: "queued", detail: "Cliente sin email registrado" };
      }

      const emailResult = await sendEmail({
        toEmail: profile.email,
        subject: decision.renderedSubject || `Lulu Island Flagship — ${params.eventKey}`,
        body: decision.renderedBody,
      });
      const emailLogStatus: "sent" | "failed" | "queued" =
        emailResult.status === "sent" ? "sent" : emailResult.status === "failed" ? "failed" : "queued";

      await supabase.from("communication_log").insert({
        order_id: params.orderId ?? null,
        user_id: params.userId,
        event_key: params.eventKey,
        category: event.category,
        channel: "email",
        language: params.language,
        body_rendered: decision.renderedBody,
        status: emailLogStatus,
        postponed_reason:
          emailResult.status === "not_configured" ? "Proveedor de email aún no configurado (TODO E6)" : null,
        sent_at: emailLogStatus === "sent" ? new Date().toISOString() : null,
      });

      return { status: emailLogStatus };
    }

    // decision.channel === "sms"
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", params.userId)
      .maybeSingle();

    if (!profile?.phone) {
      await supabase.from("communication_log").insert({
        order_id: params.orderId ?? null,
        user_id: params.userId,
        event_key: params.eventKey,
        category: event.category,
        channel: "sms",
        language: params.language,
        body_rendered: decision.renderedBody,
        status: "queued",
        postponed_reason: "Cliente sin teléfono registrado",
      });
      return { status: "queued", detail: "Cliente sin teléfono registrado" };
    }

    const smsResult = await sendSms({ phoneNumber: profile.phone, body: decision.renderedBody });
    const logStatus: "sent" | "failed" | "queued" =
      smsResult.status === "sent" ? "sent" : smsResult.status === "failed" ? "failed" : "queued";

    await supabase.from("communication_log").insert({
      order_id: params.orderId ?? null,
      user_id: params.userId,
      event_key: params.eventKey,
      category: event.category,
      channel: "sms",
      language: params.language,
      body_rendered: decision.renderedBody,
      status: logStatus,
      postponed_reason:
        smsResult.status === "not_configured" ? "Proveedor SMS aún no configurado (TODO E2/E6)" : null,
      sent_at: logStatus === "sent" ? new Date().toISOString() : null,
    });

    return { status: logStatus };
  } catch (err) {
    // Nunca dejamos que un fallo de comunicaciones rompa el flujo principal
    // (reserva, cierre de servicio, resolución de disputa) que ya es válido.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[dispatchCommunication] Error despachando '${params.eventKey}':`, message);
    return { status: "failed", detail: message };
  }
}

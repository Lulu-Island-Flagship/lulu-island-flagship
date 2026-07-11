import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  decideCallRouting,
  type AccountLocale,
  type AngerSignalInput,
  type AssignmentStatus,
  type DispatchMatrixEntry,
} from "@/lib/telephony-router";
import { getVancouverTodayString } from "@/lib/date-utils";
import { maskPhoneNumber } from "@/lib/sms";

/**
 * POST /api/telephony/webhook — v8.3 E6.2, Telefonía semántica.
 *
 * Recibe el webhook de llamada entrante de Twilio (Voice Request URL /
 * Gather action URL, ambos apuntan aquí), cruza el Caller ID con la matriz
 * de despacho de hoy usando la lógica pura de src/lib/telephony-router.ts
 * (decideCallRouting — clasifica, informa, enruta, nunca finge ser
 * persona), registra el resultado en telephony_call_log (migración 105) y
 * responde en TwiML.
 *
 * ESTADO REAL: no hay cuenta de Twilio contratada ni credenciales en este
 * repo (confirmado: cero referencias a Twilio antes de esta sesión). Todo
 * lo de autenticación/firma de webhook queda como interfaz explícita con
 * TODO — ver verifyTwilioSignature() abajo. NO se inventan credenciales,
 * SIDs ni números reales.
 *
 * FLUJO DE DOS TURNOS (simplificación estructural declarada):
 *   Turno 1 (llamada entrante, sin SpeechResult/Digits todavía): se
 *     clasifica por Caller ID solamente (sin señal de enojo aún), se
 *     informa el estado de la cita, y se abre un <Gather> para que el
 *     caller hable o presione 0 si necesita un humano.
 *   Turno 2 (Twilio vuelve a pegar a esta misma URL con SpeechResult o
 *     Digits del <Gather>): se evalúa enojo sobre lo que dijo/presionó; si
 *     hay enojo, bypass inmediato a humano; si no, se cierra la llamada.
 *
 * Esto NO es una máquina de estados de IVR completa (no persiste
 * transcripción acumulada entre turnos más allá de lo que Twilio reenvía en
 * cada POST, no maneja reintentos de gather, no tiene menú DTMF real) — es
 * la estructura mínima que conecta Caller ID -> lógica pura -> TwiML. Un
 * diseño de conversación completo (prompts, timeouts, reintentos) es
 * trabajo de producto/voz pendiente, no inventado aquí.
 */

// ------------------------------------------------------------
// Verificación de firma del webhook — INTERFAZ, sin credenciales reales
// ------------------------------------------------------------

/**
 * TODO(dueño/infra): Twilio firma cada webhook con el header
 * `X-Twilio-Signature`, calculado con HMAC-SHA1 sobre la URL completa + los
 * parámetros del POST, usando el Auth Token de la cuenta como llave (ver
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security). Este
 * proyecto NO tiene una cuenta de Twilio contratada todavía, así que:
 *   1. No existe TWILIO_AUTH_TOKEN en ninguna variable de entorno real.
 *   2. Esta función NUNCA debe "simular" una verificación exitosa — si no
 *      hay token configurado, se rechaza la petición explícitamente (fail
 *      closed), igual que sendSms() en sms.ts nunca finge un envío exitoso
 *      sin proveedor configurado.
 *   3. Cuando exista el contrato con Twilio, reemplazar el cuerpo de esta
 *      función por la validación real, por ejemplo usando el paquete
 *      oficial `twilio` (`twilio.validateRequest(authToken, signature,
 *      url, params)`). NO implementado aquí a propósito.
 */
function verifyTwilioSignature(_request: NextRequest, _rawBody: URLSearchParams): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Fail closed: sin Auth Token configurado, no hay manera honesta de
    // verificar que esta petición vino realmente de Twilio.
    return false;
  }
  // TODO(dueño/infra): implementar validateRequest real aquí cuando exista
  // cuenta de Twilio. Placeholder explícito, NO una firma falsa:
  //   const twilio = require("twilio");
  //   const signature = _request.headers.get("x-twilio-signature") ?? "";
  //   const url = _request.url;
  //   const params = Object.fromEntries(_rawBody.entries());
  //   return twilio.validateRequest(authToken, signature, url, params);
  return false;
}

// ------------------------------------------------------------
// TwiML helpers (formato mínimo que Twilio espera de vuelta)
// ------------------------------------------------------------

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Idioma TTS de Twilio <Say> más cercano a cada AccountLocale. */
function twimlSayLanguage(locale: AccountLocale): string {
  if (locale === "es") return "es-MX";
  if (locale === "zh") return "zh-CN";
  return "en-US";
}

function twiml(body: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Turno 1: informa y abre un <Gather> para detectar señales de enojo o petición explícita de humano. */
function twimlInformAndGather(message: string, locale: AccountLocale, actionUrl: string): NextResponse {
  const say = `<Say language="${twimlSayLanguage(locale)}">${xmlEscape(message)}</Say>`;
  const gather =
    `<Gather input="speech dtmf" numDigits="1" timeout="6" action="${xmlEscape(actionUrl)}" method="POST">` +
    say +
    `</Gather>` +
    // Si el Gather no captura nada, Twilio sigue aquí: terminamos limpio.
    `<Say language="${twimlSayLanguage(locale)}">${xmlEscape(
      locale === "es"
        ? "Gracias por llamar. Hasta luego."
        : locale === "zh"
          ? "感谢您的来电，再见。"
          : "Thank you for calling. Goodbye."
    )}</Say>` +
    `<Hangup/>`;
  return twiml(gather);
}

/** Escala a humano: informa el contexto brevemente y transfiere. Placeholder de número, ver TODO. */
function twimlEscalateToHuman(message: string, locale: AccountLocale): NextResponse {
  const say = `<Say language="${twimlSayLanguage(locale)}">${xmlEscape(message)}</Say>`;
  const humanNumber = process.env.TWILIO_HUMAN_ESCALATION_NUMBER;

  if (!humanNumber) {
    // TODO(dueño/infra): configurar TWILIO_HUMAN_ESCALATION_NUMBER (línea
    // real del coordinador humano, E.164) cuando exista. Sin esto, fail
    // closed con instrucción honesta en vez de un <Dial> a un número
    // inventado.
    const fallback =
      locale === "es"
        ? "En este momento no podemos transferir su llamada automáticamente. Por favor intente más tarde o envíe un mensaje de texto."
        : locale === "zh"
          ? "目前无法自动转接您的电话，请稍后再试或发送短信。"
          : "We are unable to transfer your call automatically right now. Please try again later or send a text message.";
    return twiml(say + `<Say language="${twimlSayLanguage(locale)}">${xmlEscape(fallback)}</Say><Hangup/>`);
  }

  return twiml(say + `<Dial>${xmlEscape(humanNumber)}</Dial>`);
}

/** Turno 2 sin enojo: cierra la llamada. */
function twimlGoodbye(locale: AccountLocale): NextResponse {
  const bye =
    locale === "es" ? "Gracias, hasta luego." : locale === "zh" ? "谢谢，再见。" : "Thank you, goodbye.";
  return twiml(`<Say language="${twimlSayLanguage(locale)}">${xmlEscape(bye)}</Say><Hangup/>`);
}

// ------------------------------------------------------------
// Construcción de la matriz del día (I/O — no es la lógica pura)
// ------------------------------------------------------------

/** Prioridad para colapsar varios `assignments` del mismo order_id a un solo status representativo. */
const STATUS_PRIORITY: AssignmentStatus[] = [
  "in_progress",
  "arrived",
  "en_route",
  "pending",
  "no_show",
  "cancelled",
  "completed",
];

function mostAdvancedStatus(statuses: AssignmentStatus[]): AssignmentStatus {
  for (const candidate of STATUS_PRIORITY) {
    if (statuses.includes(candidate)) return candidate;
  }
  return statuses[0] ?? "pending";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildTodayDispatchMatrix(supabase: any): Promise<DispatchMatrixEntry[]> {
  const todayStr = getVancouverTodayString();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, user_id, service_datetime, status")
    .eq("service_date", todayStr)
    .neq("status", "cancelled");

  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o: { id: string }) => o.id);
  const userIds = Array.from(new Set(orders.map((o: { user_id: string }) => o.user_id)));

  const [{ data: assignments }, { data: profiles }, { data: clientProfiles }] = await Promise.all([
    supabase.from("assignments").select("order_id, status").in("order_id", orderIds),
    supabase.from("profiles").select("id, phone").in("id", userIds),
    supabase.from("client_profiles").select("user_id, preferred_languages").in("user_id", userIds),
  ]);

  const phoneByUser = new Map<string, string | null>(
    (profiles || []).map((p: { id: string; phone: string | null }) => [p.id, p.phone])
  );
  const languageByUser = new Map<string, AccountLocale>(
    (clientProfiles || []).map((p: { user_id: string; preferred_languages: string[] | null }) => {
      const first = (p.preferred_languages ?? [])[0];
      const locale: AccountLocale = first === "es" || first === "zh" ? first : "en";
      return [p.user_id, locale];
    })
  );

  const statusesByOrder = new Map<string, AssignmentStatus[]>();
  for (const a of assignments || []) {
    const list = statusesByOrder.get(a.order_id) ?? [];
    list.push(a.status as AssignmentStatus);
    statusesByOrder.set(a.order_id, list);
  }

  const entries: DispatchMatrixEntry[] = [];
  for (const order of orders) {
    const phone = phoneByUser.get(order.user_id);
    if (!phone) continue; // sin teléfono registrado, no puede matchear por Caller ID

    const assignmentStatuses = statusesByOrder.get(order.id) ?? [];
    // Si aún no hay `assignments` (equipo no formado todavía), la orden
    // sigue "pending" desde la perspectiva del caller.
    const status: AssignmentStatus =
      assignmentStatuses.length > 0 ? mostAdvancedStatus(assignmentStatuses) : "pending";

    entries.push({
      orderId: order.id,
      userId: order.user_id,
      clientPhone: phone,
      serviceDatetimeIso: order.service_datetime,
      status,
      language: languageByUser.get(order.user_id) ?? "en",
    });
  }

  return entries;
}

// ------------------------------------------------------------
// Handler
// ------------------------------------------------------------

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);

  if (!verifyTwilioSignature(request, params)) {
    // Fail closed (ver TODO en verifyTwilioSignature). Mientras no haya
    // TWILIO_AUTH_TOKEN configurado, TODA petición se rechaza — no se
    // procesa telefonía "a medias" sin poder confirmar que vino de Twilio.
    return NextResponse.json(
      { error: "Twilio signature verification not configured (TODO: TWILIO_AUTH_TOKEN)" },
      { status: 403 }
    );
  }

  const callerPhone = params.get("From") ?? "";
  const speechResult = params.get("SpeechResult");
  const digits = params.get("Digits");

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let matrix: DispatchMatrixEntry[];
  try {
    matrix = await buildTodayDispatchMatrix(supabase);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[telephony/webhook] Error construyendo la matriz de despacho:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Idioma de respaldo si no hay match (no hay cuenta de la que leer el
  // idioma). TODO(dueño/producto): decidir si esto debe depender del
  // número troncal al que llamó (línea EN vs línea ES), hoy es fijo.
  const fallbackLocale: AccountLocale = "en";

  let angerInput: AngerSignalInput;
  const isFirstTurn = !speechResult && !digits;

  if (digits === "0") {
    angerInput = { kind: "explicit_signal", signals: ["dtmf_0_requested_human"] };
  } else if (speechResult) {
    // El idioma para escanear el transcript se decide DESPUÉS de matchear
    // (decideCallRouting internamente vuelve a llamar matchCallerToSchedule),
    // pero detectAngerSignal necesita un locale antes de eso. Aproximación:
    // reusar fallbackLocale para el primer intento; si hay match, decideCallRouting
    // ya usa el idioma real de la cuenta para el mensaje de respuesta (el
    // locale del transcript solo afecta qué lista de palabras clave se
    // escanea, así que un desfase aquí es una limitación conocida, no un bug
    // oculto: un cliente hispanohablante enojado en inglés podría no
    // detectarse si el fallback quedó en "en" — documentado, no resuelto).
    angerInput = { kind: "transcript", text: speechResult, locale: fallbackLocale };
  } else {
    angerInput = { kind: "explicit_signal", signals: [] };
  }

  const decision = decideCallRouting({
    callerPhone,
    todayDispatchMatrix: matrix,
    angerInput,
    fallbackLocale,
    nowIso: new Date().toISOString(),
  });

  // Registro para medir la meta ~80% (migración 105). Se registra en cada
  // POST que llega a resolución (turno 1 si ya escala/aún no hay match, o
  // cualquier turno donde se decide human/self_service) — ver limitación de
  // "flujo de dos turnos" en el comentario de cabecera del archivo.
  try {
    await supabase.from("telephony_call_log").insert({
      caller_phone_masked: maskPhoneNumber(callerPhone),
      matched_order_id: decision.match.matched ? decision.match.entry.orderId : null,
      route: decision.route,
      reason: decision.reason,
      anger_detected: decision.angerDetected,
      language: decision.match.matched ? decision.match.entry.language : fallbackLocale,
      response_message: decision.response.message,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[telephony/webhook] Error registrando telephony_call_log:", message);
    // No bloquea la respuesta TwiML: un fallo de logging no debe dejar al
    // caller sin respuesta (mismo principio que dispatchCommunication).
  }

  if (decision.route === "human") {
    return twimlEscalateToHuman(decision.response.message, fallbackLocaleOrMatchLanguage(decision));
  }

  if (isFirstTurn) {
    const actionUrl = new URL(request.url).toString();
    return twimlInformAndGather(
      decision.response.message,
      fallbackLocaleOrMatchLanguage(decision),
      actionUrl
    );
  }

  return twimlGoodbye(fallbackLocaleOrMatchLanguage(decision));
}

function fallbackLocaleOrMatchLanguage(decision: ReturnType<typeof decideCallRouting>): AccountLocale {
  return decision.match.matched ? decision.match.entry.language : "en";
}

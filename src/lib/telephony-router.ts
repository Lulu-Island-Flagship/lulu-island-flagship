/**
 * v8.3 E6.2 — Telefonía semántica (funciones puras, testeables).
 *
 * Regla exacta del plan (Auditoria 8.3/v8.3_PLAN_DE_CONSTRUCCION.md, E6.2):
 * "intercepta Caller ID, cruza con la matriz del día, informa y enruta
 * ('Su equipo llega en 12 minutos'). Solo clasifica, informa y enruta —
 * nunca finge conversación humana. Enojo detectado → bypass inmediato a
 * humano con contexto. Opera en el idioma de la cuenta. Meta: ~80% de
 * llamadas sin humano."
 *
 * ADVERTENCIA DE DISEÑO (léase antes de tocar este archivo):
 * Este módulo NUNCA debe generar texto libre ni conversación (nada de un
 * LLM generativo respondiendo lo que se le ocurra). Todo mensaje que sale
 * de aquí es una plantilla fija con variables sustituidas — el mismo
 * patrón de renderTemplate en communications.ts, no una reinvención. Si en
 * el futuro alguien conecta un LLM aquí para "sonar más natural", eso viola
 * la regla dura del plan ("nunca finge conversación humana") y debe
 * rechazarse en code review.
 *
 * LIMITACIONES HONESTAS (no se inventa nada no verificable):
 * 1. No existe telemetría GPS/ETA en tiempo real en el repo (se verificó:
 *    no hay tabla ni endpoint de ubicación en vivo del equipo; `assignments`
 *    solo tiene un status de texto: pending/en_route/arrived/in_progress/
 *    completed/cancelled/no_show — migración 003). El "llega en X minutos"
 *    del ejemplo del plan se calcula aquí como la diferencia entre la hora
 *    programada del servicio (orders.service_datetime) y la hora actual,
 *    NO como una predicción de tráfico en vivo. Esto es una aproximación
 *    declarada, no una funcionalidad de tracking que no existe.
 * 2. detectAngerSignal NO es un modelo de ML/sentiment analysis. Es
 *    coincidencia de palabras clave explícitas por idioma más señales
 *    explícitas del proveedor de telefonía (ej. el caller presionó "0" para
 *    pedir un humano). Es deliberadamente simple y tendrá falsos negativos:
 *    cualquier tono de enojo que no use estas palabras NO se detecta. Un
 *    detector de sentimiento real (modelo de audio/prosodia) queda fuera de
 *    alcance de este módulo — no se simula uno falso.
 */

// ------------------------------------------------------------
// Tipos compartidos
// ------------------------------------------------------------

/** Idiomas de cuenta soportados (mismo universo que send-communication.ts). */
export type AccountLocale = "en" | "es" | "zh";

/** Estados reales de `assignments.status` (migración 003_modulo3_employee_tables.sql). */
export type AssignmentStatus =
  | "pending"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

/**
 * Una fila de la "matriz del día": la cita/asignación de hoy para un
 * cliente, ya resuelta por el caller (join de orders + assignments +
 * client_profiles.preferred_languages que el orquestador async debe armar
 * antes de llamar a esta lógica pura — ver TODO en el webhook).
 */
export interface DispatchMatrixEntry {
  orderId: string;
  userId: string;
  /** E.164, ej. +16045551234. Nunca se loguea completo (PIPA) — ver maskPhoneNumber en sms.ts. */
  clientPhone: string;
  /** orders.service_datetime */
  serviceDatetimeIso: string;
  status: AssignmentStatus;
  /** Primer idioma de client_profiles.preferred_languages; fallback "en". */
  language: AccountLocale;
}

// ------------------------------------------------------------
// 1. matchCallerToSchedule
// ------------------------------------------------------------

export interface CallerMatchFound {
  matched: true;
  entry: DispatchMatrixEntry;
  /** true si había más de una cita hoy con este número (se eligió la más relevante). */
  hadMultipleCandidates: boolean;
}

export interface CallerMatchNotFound {
  matched: false;
  reason: "no_matching_order_today" | "invalid_caller_phone";
}

export type CallerMatchResult = CallerMatchFound | CallerMatchNotFound;

/** Deja solo dígitos y, si hay 11 con prefijo '1' (Norteamérica), lo quita — para tolerar +1 presente/ausente. */
function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/**
 * Busca en la matriz del día la cita que corresponde a este Caller ID.
 * Si hay varias (dos servicios el mismo día para el mismo cliente), prioriza
 * la más "accionable": no completada/cancelada/no-show, y entre esas la más
 * próxima en el tiempo. Si todas están cerradas, devuelve la más reciente.
 */
export function matchCallerToSchedule(
  callerPhone: string,
  todayDispatchMatrix: DispatchMatrixEntry[]
): CallerMatchResult {
  const callerDigits = normalizePhoneDigits(callerPhone);
  if (callerDigits.length < 10) {
    return { matched: false, reason: "invalid_caller_phone" };
  }

  const candidates = todayDispatchMatrix.filter(
    (e) => normalizePhoneDigits(e.clientPhone) === callerDigits
  );

  if (candidates.length === 0) {
    return { matched: false, reason: "no_matching_order_today" };
  }

  const closedStatuses: AssignmentStatus[] = ["completed", "cancelled", "no_show"];
  const open = candidates.filter((c) => !closedStatuses.includes(c.status));
  const pool = open.length > 0 ? open : candidates;

  const sorted = [...pool].sort(
    (a, b) => new Date(a.serviceDatetimeIso).getTime() - new Date(b.serviceDatetimeIso).getTime()
  );

  return {
    matched: true,
    entry: sorted[0],
    hadMultipleCandidates: candidates.length > 1,
  };
}

// ------------------------------------------------------------
// 2. buildInformResponse
// ------------------------------------------------------------

export interface InformResponse {
  /** Texto final a hablar/enviar por TwiML <Say>. Siempre en el idioma de la cuenta. */
  message: string;
  /** true en TODO mensaje de este módulo — recordatorio ejecutable de que nunca finge ser humano. */
  isAutomatedDisclosure: true;
}

const DISCLOSURE_PREFIX: Record<AccountLocale, string> = {
  en: "Automated line.",
  es: "Línea automatizada.",
  zh: "自动语音线路。",
};

const NO_MATCH_MESSAGE: Record<AccountLocale, string> = {
  en: "We could not find a service scheduled today for this phone number. Connecting you with a team member.",
  es: "No encontramos un servicio programado hoy para este número. La estamos comunicando con una persona.",
  zh: "我们未能找到今天与此号码对应的预约服务。正在为您转接人工服务。",
};

const COMPLETED_MESSAGE: Record<AccountLocale, string> = {
  en: "Your service today has already been completed.",
  es: "Su servicio de hoy ya fue completado.",
  zh: "您今天的服务已经完成。",
};

const CANCELLED_MESSAGE: Record<AccountLocale, string> = {
  en: "Your service today is marked as cancelled.",
  es: "Su servicio de hoy está marcado como cancelado.",
  zh: "您今天的服务已被标记为取消。",
};

const NO_SHOW_MESSAGE: Record<AccountLocale, string> = {
  en: "We were unable to complete your service today (no-show). Connecting you with a team member.",
  es: "No pudimos completar su servicio de hoy (no-show). La estamos comunicando con una persona.",
  zh: "我们今天未能完成您的服务（未到场）。正在为您转接人工服务。",
};

const ARRIVED_MESSAGE: Record<AccountLocale, string> = {
  en: "Your team has already arrived at your property.",
  es: "Su equipo ya llegó a su propiedad.",
  zh: "您的团队已经抵达您的物业。",
};

const IN_PROGRESS_MESSAGE: Record<AccountLocale, string> = {
  en: "Your team is currently working at your property.",
  es: "Su equipo está trabajando en su propiedad en este momento.",
  zh: "您的团队正在您的物业进行服务。",
};

/** "Su equipo llega en {minutes} minutos" — ejemplo textual del plan. */
function etaMessage(locale: AccountLocale, minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (locale === "es") return `Su equipo llega en ${rounded} minutos.`;
  if (locale === "zh") return `您的团队将在 ${rounded} 分钟后到达。`;
  return `Your team will arrive in ${rounded} minutes.`;
}

const RUNNING_LATE_MESSAGE: Record<AccountLocale, string> = {
  en: "Your team is running behind schedule for today's appointment. We are updating you as soon as possible.",
  es: "Su equipo va retrasado respecto a la hora programada de hoy. Le avisaremos en cuanto tengamos una actualización.",
  zh: "您的团队今天的到达时间有所延迟，我们会尽快更新信息。",
};

/**
 * Arma el mensaje "su equipo llega en X minutos" (o el estado que
 * corresponda) en el idioma de la cuenta. `nowIso` se recibe explícito
 * (nunca `new Date()` interno) siguiendo el mismo patrón de
 * evaluateDispatchDiscrepancyFallback en dispatch-fallback.ts.
 *
 * Solo se usa la frase de ETA en minutos cuando la cita está dentro de una
 * ventana razonable (<=180 min, status pending/en_route) — más allá de eso
 * decir "llega en 400 minutos" sería técnicamente cierto pero engañoso, así
 * que se informa la hora programada en su lugar. Sin GPS real (ver
 * limitación #1 al inicio del archivo), no hay manera honesta de dar una
 * ETA más precisa que "hora programada menos ahora".
 */
export function buildInformResponse(
  match: CallerMatchResult,
  locale: AccountLocale,
  nowIso: string
): InformResponse {
  const prefix = DISCLOSURE_PREFIX[locale];

  // NOTA: se usa `=== false` en vez de `!match.matched` a propósito. Sin
  // strictNullChecks (algunos entornos de verificación rápida del repo
  // compilan sin --strict), TypeScript no estrecha uniones discriminadas por
  // negación booleana (`!x.matched`) de forma confiable — sí lo hace con
  // comparación explícita (`x.matched === false`). Mismo patrón en
  // matchCallerToSchedule/decideCallRouting más abajo.
  if (match.matched === false) {
    return { message: `${prefix} ${NO_MATCH_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }

  const { entry } = match;

  if (entry.status === "completed") {
    return { message: `${prefix} ${COMPLETED_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }
  if (entry.status === "cancelled") {
    return { message: `${prefix} ${CANCELLED_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }
  if (entry.status === "no_show") {
    return { message: `${prefix} ${NO_SHOW_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }
  if (entry.status === "arrived") {
    return { message: `${prefix} ${ARRIVED_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }
  if (entry.status === "in_progress") {
    return { message: `${prefix} ${IN_PROGRESS_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }

  // pending / en_route: calcular diferencia hora programada - ahora
  const minutesUntil =
    (new Date(entry.serviceDatetimeIso).getTime() - new Date(nowIso).getTime()) / (1000 * 60);

  if (minutesUntil < 0) {
    return { message: `${prefix} ${RUNNING_LATE_MESSAGE[locale]}`, isAutomatedDisclosure: true };
  }
  if (minutesUntil > 180) {
    const scheduled = new Date(entry.serviceDatetimeIso).toISOString();
    const scheduledMsg: Record<AccountLocale, string> = {
      en: `Your service today is scheduled for ${scheduled}.`,
      es: `Su servicio de hoy está programado para ${scheduled}.`,
      zh: `您今天的服务预约时间为 ${scheduled}。`,
    };
    return { message: `${prefix} ${scheduledMsg[locale]}`, isAutomatedDisclosure: true };
  }

  return { message: `${prefix} ${etaMessage(locale, minutesUntil)}`, isAutomatedDisclosure: true };
}

// ------------------------------------------------------------
// 3. detectAngerSignal
// ------------------------------------------------------------

/**
 * Entrada de detección: o bien un transcript crudo (texto reconocido por el
 * proveedor de voz, ej. Twilio <Gather input="speech">) que se escanea por
 * palabras clave explícitas del idioma de la cuenta, o bien señales
 * explícitas ya identificadas fuera de este módulo (ej. el caller presionó
 * DTMF "0" pidiendo un humano — eso NO es inferencia, es una acción
 * explícita del usuario y siempre debe bypasear).
 */
export type AngerSignalInput =
  | { kind: "transcript"; text: string; locale: AccountLocale }
  | { kind: "explicit_signal"; signals: string[] };

export interface AngerDetectionResult {
  angerDetected: boolean;
  /** Por qué se detectó (o no) — para el contexto que se le pasa al humano. */
  reason: string;
  matchedKeywords?: string[];
}

/**
 * Lista de palabras clave NAIVE por idioma. Coincidencia de substring, sin
 * normalización morfológica ni contexto — esto es intencionalmente simple
 * (ver limitación #2 al inicio del archivo). No es un clasificador de
 * sentimiento; es un filtro de seguridad barato que prioriza NUNCA dejar a
 * un cliente enojado atrapado con el sistema automatizado, a costa de
 * escalar de más (falsos positivos) antes que de menos (falsos negativos
 * silenciosos son el riesgo peor).
 */
const ANGER_KEYWORDS: Record<AccountLocale, string[]> = {
  es: [
    "estafa",
    "pésimo",
    "terrible",
    "inaceptable",
    "harto",
    "furioso",
    "indignado",
    "quiero hablar con una persona",
    "quiero un humano",
    "esto es una vergüenza",
    "grosero",
    "demanda",
  ],
  en: [
    "scam",
    "terrible",
    "unacceptable",
    "furious",
    "ridiculous",
    "fed up",
    "speak to a human",
    "speak to a person",
    "this is a joke",
    "rude",
    "lawsuit",
    "sue you",
  ],
  zh: ["骗子", "太差了", "投诉", "气死我了", "找人工", "转人工", "太差劲", "起诉"],
};

/** Señales explícitas que SIEMPRE bypasean, sin importar el idioma. */
const EXPLICIT_BYPASS_SIGNALS = new Set([
  "dtmf_0_requested_human",
  "vendor_flagged_negative_sentiment",
  "caller_hung_up_and_recalled_3x",
]);

export function detectAngerSignal(input: AngerSignalInput): AngerDetectionResult {
  if (input.kind === "explicit_signal") {
    const matched = input.signals.filter((s) => EXPLICIT_BYPASS_SIGNALS.has(s));
    if (matched.length > 0) {
      return {
        angerDetected: true,
        reason: `Señal explícita recibida: ${matched.join(", ")}`,
        matchedKeywords: matched,
      };
    }
    return { angerDetected: false, reason: "Sin señales explícitas de enojo reconocidas" };
  }

  const haystack = input.text.toLowerCase();
  const keywords = ANGER_KEYWORDS[input.locale];
  const matched = keywords.filter((kw) => haystack.includes(kw.toLowerCase()));

  if (matched.length > 0) {
    return {
      angerDetected: true,
      reason: `Palabra(s) clave de enojo detectada(s) en el idioma '${input.locale}': ${matched.join(", ")}`,
      matchedKeywords: matched,
    };
  }

  return {
    angerDetected: false,
    reason:
      "Sin coincidencias de palabras clave (detección naive por substring — no es un modelo de sentimiento; puede haber falsos negativos)",
  };
}

// ------------------------------------------------------------
// 4. decideCallRouting — combina todo
// ------------------------------------------------------------

export interface DecideCallRoutingInput {
  callerPhone: string;
  todayDispatchMatrix: DispatchMatrixEntry[];
  angerInput: AngerSignalInput;
  /** Idioma de cuenta a usar si NO hay match en la matriz (fallback declarado por el caller del webhook, ej. idioma del número troncal). */
  fallbackLocale: AccountLocale;
  nowIso: string;
}

export type CallRoute = "self_service" | "human";

export interface HumanEscalationContext {
  callerPhone: string;
  reason: string;
  matchSummary: string | null;
  angerDetail: AngerDetectionResult | null;
}

export interface CallRoutingDecision {
  route: CallRoute;
  reason: string;
  angerDetected: boolean;
  match: CallerMatchResult;
  response: InformResponse;
  /** Presente solo cuando route === "human": contexto para que el agente humano no empiece de cero. */
  humanContext?: HumanEscalationContext;
}

/**
 * Punto único de decisión. Orden de evaluación (no negociable, mismo orden
 * que exige el plan):
 *   1. Enojo detectado → bypass inmediato a humano CON CONTEXTO, sin
 *      importar si hay match de agenda o no.
 *   2. Si no hay enojo → clasifica (matchCallerToSchedule), informa
 *      (buildInformResponse) y enruta: self_service si hubo match (la
 *      llamada se resuelve sola, cuenta para la meta ~80%), humano si no
 *      hubo match (el sistema no tiene con qué responder, no debe inventar).
 *
 * Este es el ÚNICO lugar donde se decide "sin humano" vs "con humano" —
 * cualquier otro punto del sistema que necesite esa decisión debe llamar
 * aquí, no reimplementar el orden de evaluación.
 */
/**
 * Idioma a usar dado un resultado de match: el de la cuenta si hubo match,
 * el fallback declarado por el caller del webhook si no. Extraído como
 * función con `if/else` explícito (no ternario) por la misma razón de
 * estrechado de tipos documentada en buildInformResponse.
 */
function localeForMatch(match: CallerMatchResult, fallback: AccountLocale): AccountLocale {
  if (match.matched === false) return fallback;
  return match.entry.language;
}

/** Resumen corto de la cita para pasarle contexto al humano al escalar. */
function matchSummaryFor(match: CallerMatchResult): string | null {
  if (match.matched === false) return null;
  return `Orden ${match.entry.orderId}, estado ${match.entry.status}, cita ${match.entry.serviceDatetimeIso}`;
}

export function decideCallRouting(input: DecideCallRoutingInput): CallRoutingDecision {
  const angerResult = detectAngerSignal(input.angerInput);

  if (angerResult.angerDetected) {
    const match = matchCallerToSchedule(input.callerPhone, input.todayDispatchMatrix);
    const locale = localeForMatch(match, input.fallbackLocale);
    const response = buildInformResponse(match, locale, input.nowIso);
    return {
      route: "human",
      reason: "anger_detected",
      angerDetected: true,
      match,
      response,
      humanContext: {
        callerPhone: input.callerPhone,
        reason: angerResult.reason,
        matchSummary: matchSummaryFor(match),
        angerDetail: angerResult,
      },
    };
  }

  const match = matchCallerToSchedule(input.callerPhone, input.todayDispatchMatrix);
  const locale = localeForMatch(match, input.fallbackLocale);
  const response = buildInformResponse(match, locale, input.nowIso);

  if (match.matched === false) {
    return {
      route: "human",
      reason: match.reason,
      angerDetected: false,
      match,
      response,
      humanContext: {
        callerPhone: input.callerPhone,
        reason: match.reason,
        matchSummary: null,
        angerDetail: null,
      },
    };
  }

  return {
    route: "self_service",
    reason: `Clasificado y resuelto sin humano (status: ${match.entry.status})`,
    angerDetected: false,
    match,
    response,
  };
}

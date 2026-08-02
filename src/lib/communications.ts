/**
 * v8.3 E6 — Motor de comunicaciones (funciones puras, testeables):
 *   1. renderTemplate: sustituye {variables} y FALLA RUIDOSAMENTE si falta una
 *      (un SMS con "{nombre_cliente}" literal es inaceptable en premium).
 *   2. arbitrateThrottle: árbitro anti-fatiga (M13 F13.3) — un cliente nunca
 *      recibe trigger físico Y campaña la misma semana; urgentes nunca se
 *      retrasan; máximo 1 mensaje de marketing por usuario por semana.
 */

export class MissingVariableError extends Error {
  constructor(public missing: string[]) {
    super(`Plantilla con variables sin valor: ${missing.join(", ")}`);
    this.name = "MissingVariableError";
  }
}

// Fix revertido (pentest 2026-08-02, revisado 2026-08-02): un agente externo
// (Kimi) agregó un escapeHtml() aquí sobre el argumento de que renderTemplate
// inserta valores de usuario sin sanitizar ("XSS latente"). Se revirtió tras
// rastrear los 3 consumidores reales de este output (los únicos que existen
// hoy, ver send-communication.ts):
//   1. SMS -> sendSms(): texto plano por definición del canal.
//   2. Email -> sendEmail() -> Resend API con `text: input.body` (NO `html:`,
//      ver email.ts línea ~78) -- también texto plano, el proveedor no lo
//      interpreta como HTML.
//   3. Admin timeline -> OrderCommunicationTimeline.tsx renderiza
//      {entry.body_rendered} como children de JSX (no dangerouslySetInnerHTML)
//      -- React ya escapa automáticamente ese contenido antes de insertarlo
//      en el DOM.
// Ningún consumidor interpreta este string como HTML, así que no hay sink de
// XSS real en la ruta actual -- escapar aquí no cierra ninguna vulnerabilidad
// existente, solo corrompe el mensaje real que recibe el cliente en
// cualquier variable con apóstrofe, "&", comillas o </> (ej. un nombre como
// "O'Brien" saldría como "O&#39;Brien" en un SMS de verdad). Si en el futuro
// se agrega un canal que SÍ renderice este body como HTML (ej. un email en
// HTML real, o un dangerouslySetInnerHTML en algún dashboard), el escape debe
// aplicarse en ESE punto de salida específico -- no acá, donde alimenta por
// igual a canales de texto plano. Ver test "no escapa HTML -- los 3
// consumidores actuales son texto plano" más abajo, que documenta esta
// decisión para que no se reintroduzca sin repetir esta verificación.
/** Sustituye {var}. Lanza MissingVariableError si el template usa una variable no provista. */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number>
): string {
  const missing: string[] = [];
  const rendered = body.replace(/\{(\w+)\}/g, (_m, key: string) => {
    if (vars[key] === undefined || vars[key] === null) {
      missing.push(key);
      return `{${key}}`;
    }
    return String(vars[key]);
  });
  if (missing.length > 0) throw new MissingVariableError(Array.from(new Set(missing)));
  return rendered;
}

// ------------------------------------------------------------
// Throttling anti-fatiga
// ------------------------------------------------------------

export interface ProposedMessage {
  id: string;
  userId: string;
  eventKey: string;
  category: "transactional" | "marketing";
  priority: "urgent" | "normal";
  /** prioridad relativa dentro de marketing: mayor gana la semana */
  marketingWeight?: number;
}

export interface ThrottleResult {
  send: ProposedMessage[];
  postponed: { message: ProposedMessage; reason: string }[];
}

/**
 * Decide qué se envía y qué se pospone.
 * @param proposed mensajes candidatos de este ciclo
 * @param marketingSentThisWeek userIds que YA recibieron marketing esta semana
 */
export function arbitrateThrottle(
  proposed: ProposedMessage[],
  marketingSentThisWeek: Set<string>
): ThrottleResult {
  const send: ProposedMessage[] = [];
  const postponed: ThrottleResult["postponed"] = [];

  // 1. Urgentes y transaccionales: nunca se retrasan (CASL: sin opt-in requerido)
  for (const m of proposed) {
    if (m.priority === "urgent" || m.category === "transactional") send.push(m);
  }

  // Fix (auditoría externa, hallazgo #4): antes, si en el mismo ciclo se
  // proponían mensajes transaccionales/urgentes Y de marketing para el
  // MISMO usuario, ambos se enviaban -- violando la regla anti-fatiga (M13
  // F13.3: "un cliente nunca recibe trigger físico Y campaña la misma
  // semana"). El chequeo de `marketingSentThisWeek` solo miraba envíos de
  // ciclos ANTERIORES, no lo que se está enviando en ESTE ciclo. Ahora se
  // calcula el set de usuarios que van a recibir un transaccional/urgente en
  // este mismo ciclo y se pospone cualquier marketing para ellos también.
  const usersReceivingUrgentOrTransactionalThisCycle = new Set(send.map((m) => m.userId));

  // 2. Marketing: máximo UNO por usuario por semana; el de mayor peso gana
  const marketingByUser = new Map<string, ProposedMessage[]>();
  for (const m of proposed) {
    if (m.category === "marketing" && m.priority !== "urgent") {
      (marketingByUser.get(m.userId) ?? marketingByUser.set(m.userId, []).get(m.userId)!).push(m);
    }
  }

  marketingByUser.forEach((candidates, userId) => {
    if (usersReceivingUrgentOrTransactionalThisCycle.has(userId)) {
      for (const m of candidates) {
        postponed.push({
          message: m,
          reason: "Usuario recibe un mensaje transaccional/urgente en este mismo ciclo (M13 F13.3: no bombardear)",
        });
      }
      return;
    }
    if (marketingSentThisWeek.has(userId)) {
      for (const m of candidates) {
        postponed.push({ message: m, reason: "Usuario ya recibió marketing esta semana (M13 F13.3)" });
      }
      return;
    }
    const sorted = [...candidates].sort(
      (a, b) => (b.marketingWeight ?? 0) - (a.marketingWeight ?? 0)
    );
    send.push(sorted[0]);
    for (const loser of sorted.slice(1)) {
      postponed.push({
        message: loser,
        reason: `Perdió el arbitraje semanal contra '${sorted[0].eventKey}' (mayor prioridad)`,
      });
    }
  });

  return { send, postponed };
}

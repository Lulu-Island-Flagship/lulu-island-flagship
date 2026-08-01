import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting, getHiringFlowServiceClient } from "./settings-service";
import { generateRawCode, hashCode } from "./access-code-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 3: Autenticación y Seguridad Base.
//
// Tabla asumida (contrato acordado con la migración de Fase 2 que se está
// creando en paralelo):
//   sessions(
//     id UUID,
//     candidate_id UUID,
//     token_hash TEXT,
//     expires_at TIMESTAMPTZ,
//     last_activity_at TIMESTAMPTZ,
//     invalidated_at TIMESTAMPTZ,
//     created_at TIMESTAMPTZ
//   )
//
// Mismo patrón que access_codes: el token NUNCA se guarda en texto plano,
// solo su hash (token_hash). El token en crudo únicamente existe de forma
// transitoria en memoria, en el valor de retorno de createSession(), para
// poder entregárselo al cliente (ej. cookie httpOnly) una sola vez.
//
// Reusa generateRawCode()/hashCode() de access-code-service.ts en vez de
// duplicar lógica de generación/hashing: un token de sesión y un código de
// acceso son, en esencia, "un secreto aleatorio de alta entropía + su
// hash SHA-256", exactamente lo que esas dos funciones ya resuelven. No
// hace falta un alfabeto sin ambigüedad aquí (el token nunca se tipea a
// mano), pero reutilizar la función es preferible a introducir una segunda
// implementación de generación aleatoria a mantener en paralelo.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SessionsClient = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class SessionInvalidError extends Error {
  constructor() {
    super("Session invalid: no matching token_hash, or session was invalidated");
    this.name = "SessionInvalidError";
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired: expires_at passed or inactive beyond the allowed window");
    this.name = "SessionExpiredError";
  }
}

// ---------------------------------------------------------------------------
// Supabase client resolution — mismo patrón que settings-service
// ---------------------------------------------------------------------------

function resolveClient(client?: SessionsClient): SessionsClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a sessions"
    );
  }
  return resolved;
}

interface SessionRow {
  id: string;
  candidate_id: string;
  expires_at: string;
  last_activity_at: string;
  invalidated_at: string | null;
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

export async function createSession(
  candidateId: string,
  client?: SessionsClient
): Promise<{ rawToken: string; expiresAt: Date }> {
  const resolved = resolveClient(client);

  // Nunca hardcodear duración de sesión: viene de system_settings.
  const durationHours = Number(
    await getSetting("security_session_duration_hours", resolved)
  );
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    throw new Error(
      `Invalid security_session_duration_hours setting: expected a positive number, got "${durationHours}"`
    );
  }

  const rawToken = generateRawCode();
  const tokenHash = hashCode(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  const { error } = await resolved.from("sessions").insert({
    candidate_id: candidateId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    last_activity_at: now.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return { rawToken, expiresAt };
}

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------

// Valida tres condiciones distintas, en este orden:
//   1. La sesión existe (token_hash matchea) -> si no, SessionInvalidError.
//   2. No fue invalidada explícitamente (invalidated_at IS NULL) -> si lo
//      fue, SessionInvalidError (una sesión invalidada no es "expirada",
//      es inválida por decisión explícita: logout, revocación admin, etc).
//   3. No expiró por tiempo absoluto (expires_at) NI por inactividad
//      (last_activity_at + el mismo umbral de duración configurado) -> si
//      cualquiera de las dos pasó, SessionExpiredError. El plan pide
//      explícitamente "invalidar por inactividad", así que el mismo
//      security_session_duration_hours se usa como ventana de inactividad
//      máxima permitida desde la última actividad registrada.
export async function validateSession(
  rawToken: string,
  client?: SessionsClient
): Promise<{ sessionId: string; candidateId: string }> {
  const resolved = resolveClient(client);
  const tokenHash = hashCode(rawToken);

  const { data, error } = await resolved
    .from("sessions")
    .select("id, candidate_id, expires_at, last_activity_at, invalidated_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate session: ${error.message}`);
  }

  const row = data as SessionRow | null;
  if (!row) {
    throw new SessionInvalidError();
  }

  if (row.invalidated_at !== null) {
    throw new SessionInvalidError();
  }

  const now = Date.now();

  if (new Date(row.expires_at).getTime() < now) {
    throw new SessionExpiredError();
  }

  const durationHours = Number(
    await getSetting("security_session_duration_hours", resolved)
  );
  if (Number.isFinite(durationHours) && durationHours > 0) {
    const inactivityLimitMs = durationHours * 60 * 60 * 1000;
    const lastActivityMs = new Date(row.last_activity_at).getTime();
    if (now - lastActivityMs > inactivityLimitMs) {
      throw new SessionExpiredError();
    }
  }

  // Fix (auditoría externa, hallazgo confirmado): validateSession() revisa
  // last_activity_at (para el chequeo de expiración por inactividad de
  // arriba) pero nunca lo actualizaba -- una sesión activa e ininterrumpida
  // habría quedado marcada como "inactiva" tras security_session_duration_hours
  // igual, porque nada refrescaba la marca de tiempo en cada validación
  // exitosa. renewSession() ya existe con exactamente este UPDATE, pero
  // dependía de que cada caller HTTP se acordara de invocarla por separado
  // después de validar -- ahora la propia validación exitosa refresca la
  // actividad, best-effort (si el UPDATE falla, no debe tumbar una sesión
  // que sí es válida; se loguea y se sigue).
  const { error: touchError } = await resolved
    .from("sessions")
    .update({ last_activity_at: new Date(now).toISOString() })
    .eq("id", row.id);
  if (touchError) {
    console.error(
      `[session-service] Failed to refresh last_activity_at for session "${row.id}" (non-fatal):`,
      touchError.message
    );
  }

  return { sessionId: row.id, candidateId: row.candidate_id };
}

// ---------------------------------------------------------------------------
// renewSession
// ---------------------------------------------------------------------------

export async function renewSession(
  sessionId: string,
  client?: SessionsClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { error } = await resolved
    .from("sessions")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to renew session: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// invalidateSession
// ---------------------------------------------------------------------------

export async function invalidateSession(
  sessionId: string,
  client?: SessionsClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { error } = await resolved
    .from("sessions")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    throw new Error(`Failed to invalidate session: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// purgeExpiredSessions
// ---------------------------------------------------------------------------

// Pensado para correr desde un cron/job periódico (ver Fase 7 del plan),
// NUNCA desde el request path: borrar filas es trabajo de mantenimiento en
// batch, no algo que deba bloquear la respuesta a un candidato. Un endpoint
// de request normal solo debería llamar a validateSession/renewSession/
// invalidateSession; este purge es exclusivamente para el job programado.
export async function purgeExpiredSessions(
  client?: SessionsClient
): Promise<number> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("sessions")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("id");

  if (error) {
    throw new Error(`Failed to purge expired sessions: ${error.message}`);
  }

  return (data ?? []).length;
}

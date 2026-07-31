// v0.4.1 (flujo de contratación / candidate hiring flow) -- Fase 2
// "Modelo de Datos Completo".
//
// Este archivo define SOLO el modelo de datos (una interfaz TS por tabla
// de supabase/migrations/256..267) y validaciones de integridad puras a
// nivel de modelo (formato de un email, de un teléfono, etc.).
//
// Deliberadamente NO incluye:
//   - Lógica de negocio (ej. "¿puede este candidato avanzar de step2 a
//     step3?", "¿está vencido este access_code?") -- eso vive en los
//     servicios (settings-service.ts, legal-text-service.ts y los que se
//     agreguen para este modelo), no aquí.
//   - Llamadas a Supabase / IO de ningún tipo -- este archivo es puro y
//     sincrónico, sin dependencias externas, para poder testear la
//     validación de formato sin mockear nada.
//
// Convención de nombres: cada interfaz usa camelCase (idiomático en TS)
// y el comentario sobre cada campo, cuando el nombre de columna difiere,
// indica el nombre snake_case real en Postgres. El mapeo DB <-> TS (el
// snake_case <-> camelCase real de filas devueltas por supabase-js) es
// responsabilidad de la capa de servicio, no de este archivo.

// -----------------------------------------------------------------------
// positions (migración 256)
// -----------------------------------------------------------------------

export interface Position {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isPublic: boolean; // is_public
  createdAt: string; // created_at (ISO timestamp)
  updatedAt: string; // updated_at (ISO timestamp)
  createdBy: string | null; // created_by (auth.users.id)
}

// -----------------------------------------------------------------------
// candidates (migración 257)
// -----------------------------------------------------------------------

export type CandidateStatus =
  | "step1_completed"
  | "step2_completed"
  | "step3_completed"
  | "approved"
  | "rejected";

export const CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  "step1_completed",
  "step2_completed",
  "step3_completed",
  "approved",
  "rejected",
];

export interface Candidate {
  id: string;
  positionId: string | null; // position_id
  firstName: string; // first_name
  lastName: string; // last_name
  email: string;
  phone: string;
  dateOfBirth: string | null; // date_of_birth (YYYY-MM-DD)
  status: CandidateStatus;
  createdAt: string; // created_at
  updatedAt: string; // updated_at
}

// -----------------------------------------------------------------------
// candidate_availability (migración 258)
// -----------------------------------------------------------------------

// 0 = domingo .. 6 = sábado (misma convención documentada en la
// migración 258; el mapeo a nombre de día/locale es responsabilidad de
// la capa de presentación, no de este modelo).
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface CandidateAvailability {
  id: string;
  candidateId: string; // candidate_id
  dayOfWeek: DayOfWeek | null; // day_of_week
  startTime: string | null; // start_time (HH:MM:SS)
  endTime: string | null; // end_time (HH:MM:SS)
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// access_codes (migración 259)
// -----------------------------------------------------------------------

export type AccessCodePurpose = "step2" | "step3";

export const ACCESS_CODE_PURPOSES: readonly AccessCodePurpose[] = ["step2", "step3"];

export interface AccessCode {
  id: string;
  candidateId: string; // candidate_id
  codeHash: string; // code_hash -- NUNCA el código en texto plano
  purpose: AccessCodePurpose;
  expiresAt: string; // expires_at
  usedAt: string | null; // used_at
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// sessions (migración 260)
// -----------------------------------------------------------------------

export interface HiringFlowSession {
  id: string;
  candidateId: string; // candidate_id
  tokenHash: string; // token_hash -- NUNCA el token en texto plano
  expiresAt: string; // expires_at
  lastActivityAt: string; // last_activity_at
  invalidatedAt: string | null; // invalidated_at
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// documents (migración 261)
// -----------------------------------------------------------------------

export interface CandidateDocument {
  id: string;
  candidateId: string; // candidate_id
  documentType: string; // document_type
  storagePath: string; // storage_path
  mimeType: string; // mime_type
  sizeBytes: number; // size_bytes (> 0)
  uploadedAt: string; // uploaded_at
}

// -----------------------------------------------------------------------
// electronic_signatures (migración 262)
// -----------------------------------------------------------------------

export interface ElectronicSignature {
  id: string;
  candidateId: string; // candidate_id
  documentReference: string; // document_reference -- qué se firmó
  documentHash: string; // document_hash
  signedAt: string; // signed_at
  ipAddress: string; // ip_address
  userAgent: string | null; // user_agent
}

// -----------------------------------------------------------------------
// consents (migración 263)
// -----------------------------------------------------------------------

export interface Consent {
  id: string;
  candidateId: string; // candidate_id
  legalTextKey: string; // legal_text_key
  legalTextVersion: string; // legal_text_version
  legalTextId: string | null; // legal_text_id (FK a legal_texts.id)
  accepted: boolean;
  ipAddress: string; // ip_address
  userAgent: string | null; // user_agent
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// hr_users (migración 264)
// -----------------------------------------------------------------------

export type HrRole = "recruiter" | "hr_admin";

export const HR_ROLES: readonly HrRole[] = ["recruiter", "hr_admin"];

export interface HrUser {
  id: string;
  authUserId: string; // auth_user_id (auth.users.id)
  fullName: string; // full_name
  role: HrRole;
  active: boolean;
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// audit_logs (migración 265)
// -----------------------------------------------------------------------

export type AuditActorType = "hr_user" | "candidate" | "system";

export const AUDIT_ACTOR_TYPES: readonly AuditActorType[] = ["hr_user", "candidate", "system"];

export interface AuditLog {
  id: string;
  actorType: AuditActorType; // actor_type
  actorId: string | null; // actor_id (sin FK -- referencia polimórfica, ver migración 265)
  action: string;
  entityType: string; // entity_type
  entityId: string | null; // entity_id
  metadata: Record<string, unknown> | null;
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// communications (migración 266)
// -----------------------------------------------------------------------

export type CommunicationChannel = "sms" | "email";
export type CommunicationStatus = "queued" | "sent" | "failed";

export const COMMUNICATION_CHANNELS: readonly CommunicationChannel[] = ["sms", "email"];
export const COMMUNICATION_STATUSES: readonly CommunicationStatus[] = ["queued", "sent", "failed"];

export interface Communication {
  id: string;
  candidateId: string; // candidate_id
  channel: CommunicationChannel;
  templateKey: string | null; // template_key
  status: CommunicationStatus;
  sentAt: string | null; // sent_at
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// funnel_events (migración 267)
// -----------------------------------------------------------------------
//
// Tabla de hechos: los reportes deben leer de aquí, no de
// `candidates.status` (ver comentario de cabecera de la migración 267).

export interface FunnelEvent {
  id: string;
  candidateId: string; // candidate_id
  eventType: string; // event_type
  fromStatus: string | null; // from_status
  toStatus: string | null; // to_status
  createdAt: string; // created_at
}

// -----------------------------------------------------------------------
// Validaciones puras de integridad a nivel de modelo
// -----------------------------------------------------------------------
//
// Solo formato/forma de un valor aislado -- nada que dependa de otras
// filas, de la DB, ni de reglas de negocio (ej. "¿puede este candidato
// hacer X?" NO va aquí).

// Email: validación de formato deliberadamente simple (no intenta cubrir
// el 100% de RFC 5322 -- eso es notoriamente impráctico e innecesario
// aquí). Suficiente para rechazar valores obviamente inválidos antes de
// persistir. [ASSUMPTION] se prioriza pragmatismo sobre exhaustividad,
// igual que la mayoría de validadores de email en producción.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

// Teléfono canadiense: acepta formatos comunes con o sin +1, con o sin
// separadores (espacios, guiones, paréntesis), exigiendo 10 dígitos
// (NANP: 3 dígitos de área + 7 dígitos) tras normalizar. [ASSUMPTION] el
// plan no especifica el formato exacto de entrada esperado del
// formulario -- se optó por ser permisivo en la entrada (usuario puede
// escribir "(604) 555-0123", "604-555-0123", "+1 604 555 0123", etc.) y
// estricto solo en el conteo final de dígitos, que es lo que realmente
// importa para poder enviar un SMS (ver `access_codes`/`communications`).
const CANADIAN_PHONE_STRIP_RE = /[\s().-]/g;

export function isValidCanadianPhone(phone: string): boolean {
  if (typeof phone !== "string") return false;
  let digits = phone.replace(CANADIAN_PHONE_STRIP_RE, "");
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  // Acepta con o sin el prefijo de país "1" (NANP -- Canadá y EE.UU.
  // comparten el mismo plan de numeración; no se distingue Canadá de
  // EE.UU. a nivel de formato porque el número por sí solo no lo permite
  // -- [ASSUMPTION] esa distinción, si hace falta, requeriría una lista
  // de área codes canadienses fuera de alcance de este validador puro).
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return false;
  if (!/^\d{10}$/.test(digits)) return false;
  // El primer dígito del código de área y del exchange no puede ser 0 o 1
  // (regla NANP básica) -- rechaza números obviamente inválidos como
  // "0000000000".
  const areaCodeFirstDigit = digits[0];
  const exchangeFirstDigit = digits[3];
  if (areaCodeFirstDigit === "0" || areaCodeFirstDigit === "1") return false;
  if (exchangeFirstDigit === "0" || exchangeFirstDigit === "1") return false;
  return true;
}

// UUID v4 (y en general, cualquier UUID con guiones en el formato
// estándar de Postgres) -- usado para validar IDs recibidos de input
// externo (ej. un candidateId en un parámetro de ruta) antes de usarlos
// en una consulta.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

// Slug de position (256): minúsculas, dígitos y guiones, sin espacios ni
// guiones al inicio/fin ni dobles -- para que sea seguro usarlo
// directamente en una URL pública (/aplicar/<slug>).
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidPositionSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (slug.length === 0 || slug.length > 200) return false;
  return SLUG_RE.test(slug);
}

export function isValidCandidateStatus(status: string): status is CandidateStatus {
  return (CANDIDATE_STATUSES as readonly string[]).includes(status);
}

export function isValidAccessCodePurpose(purpose: string): purpose is AccessCodePurpose {
  return (ACCESS_CODE_PURPOSES as readonly string[]).includes(purpose);
}

export function isValidDayOfWeek(value: number): value is DayOfWeek {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

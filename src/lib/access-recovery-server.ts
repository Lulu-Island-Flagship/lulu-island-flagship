/**
 * v8.3 E11 — Recuperación de acceso: helpers server-side con I/O (Supabase,
 * envío de mensajes). Separado de src/lib/access-recovery.ts (funciones
 * puras) para que la lógica de hashing/expiración se pueda testear sin
 * Supabase.
 *
 * Todas las funciones aquí reciben un cliente service-role ya creado por el
 * caller (getServiceRoleClient() en src/lib/admin.ts) -- este módulo nunca
 * decide autorización, solo ejecuta operaciones ya autorizadas por la ruta
 * que lo llama.
 */
// Fix (auditoría 2026-07-31, severidad media): antes `ServiceClient` era un
// alias directo de `any`. El resto del proyecto usa el patrón
// `SupabaseClient<any, "public", any>` para clientes sin tipos de schema
// generados (ver src/lib/client-module/*.ts, src/lib/send-communication.ts) --
// se alinea este módulo al mismo patrón.
import type { SupabaseClient } from "@supabase/supabase-js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, "public", any>;

import { renderTemplate } from "./communications";
import { sendSms, maskPhoneNumber } from "./sms";
import { sendEmail, maskEmail } from "./email";
import { generateBackupCode, hashBackupCode } from "./backup-codes";

export interface TrustedSuccessorRow {
  id: string;
  name: string;
  contact_phone: string | null;
  contact_email: string | null;
  is_active: boolean;
}

export type AuditEventType =
  | "request_lookup_attempt"
  | "request_created"
  | "verification_code_sent"
  | "verification_succeeded"
  | "verification_failed"
  | "verification_expired"
  | "other_successors_notified"
  | "unified_alert_published"
  | "co_verification_code_sent"
  | "co_verification_succeeded"
  | "co_verification_failed"
  | "admin_approved"
  | "admin_denied"
  | "emergency_code_issued";

/** Inserta en access_recovery_audit_log. Nunca lanza -- un fallo de auditoría se loguea a consola pero no debe tumbar el flujo de seguridad principal (mismo trade-off que publishUnifiedAlert). Distinto del log de admin_action_logs (admin.ts), que SÍ bloquea la acción -- ahí la escritura la hace un admin autenticado con alternativa de reintentar; aquí puede ser un successor a mitad de un flujo de emergencia sin sesión. */
export async function logRecoveryAuditEvent(
  supabase: ServiceClient,
  input: {
    requestId?: string | null;
    eventType: AuditEventType;
    actorType: "successor" | "admin" | "system";
    actorRef?: string | null;
    detail?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("access_recovery_audit_log").insert({
    request_id: input.requestId ?? null,
    event_type: input.eventType,
    actor_type: input.actorType,
    actor_ref: input.actorRef ?? null,
    detail: input.detail ?? null,
  });
  if (error) {
    console.error("[access-recovery] audit log insert failed:", error.message);
  }
}

/** Todos los trusted_successors activos, sin borrar (deleted_at IS NULL, is_active = true). */
export async function getActiveSuccessors(supabase: ServiceClient): Promise<TrustedSuccessorRow[]> {
  const { data } = await supabase
    .from("trusted_successors")
    .select("id, name, contact_phone, contact_email, is_active")
    .eq("is_active", true)
    .is("deleted_at", null);
  return data ?? [];
}

/** Compara un contacto ingresado por el solicitante contra el YA REGISTRADO en trusted_successors -- normaliza email a minúsculas y teléfono a solo dígitos para tolerar formato distinto, pero SIEMPRE compara contra el valor guardado, nunca acepta uno nuevo. */
export function contactMatches(stored: string | null, input: string): boolean {
  if (!stored) return false;
  const isEmail = input.includes("@");
  if (isEmail) return stored.trim().toLowerCase() === input.trim().toLowerCase();
  const storedDigits = stored.replace(/\D/g, "");
  const inputDigits = input.replace(/\D/g, "");
  return storedDigits.length > 0 && storedDigits === inputDigits;
}

/** Busca UN successor activo cuyo contacto YA REGISTRADO coincida. Si hay ambigüedad (no debería pasar con datos limpios) devuelve null por seguridad en vez de adivinar. */
export async function findActiveSuccessorByContact(
  supabase: ServiceClient,
  contact: string
): Promise<TrustedSuccessorRow | null> {
  const successors = await getActiveSuccessors(supabase);
  const matches = successors.filter(
    (s) => contactMatches(s.contact_phone, contact) || contactMatches(s.contact_email, contact)
  );
  return matches.length === 1 ? matches[0] : null;
}

export function otherActiveSuccessors(
  successors: TrustedSuccessorRow[],
  excludeId: string
): TrustedSuccessorRow[] {
  return successors.filter((s) => s.id !== excludeId);
}

/** Enmascara el contacto de un successor para dejarlo en logs/auditoría sin exponer PII (PIPA), igual que maskPhoneNumber/maskEmail para clientes. */
export function maskSuccessorContact(successor: TrustedSuccessorRow): string {
  if (successor.contact_phone) return maskPhoneNumber(successor.contact_phone);
  if (successor.contact_email) return maskEmail(successor.contact_email);
  return "***";
}

/** Renderiza la plantilla vigente en francés del catálogo (communication_templates) para un event_key. Fallback a inglés si no hay plantilla en fr. Devuelve null si tampoco hay plantilla en inglés (nunca inventa texto). */
export async function renderCatalogTemplate(
  supabase: ServiceClient,
  eventKey: string,
  vars: Record<string, string | number>,
  language: "fr" | "en" = "fr"
): Promise<string | null> {
  const { data: template } = await supabase
    .from("communication_templates")
    .select("body")
    .eq("event_key", eventKey)
    .eq("language", language)
    .eq("is_current", true)
    .is("deleted_at", null)
    .maybeSingle();

  let body = template?.body as string | undefined;
  if (!body && language !== "en") {
    const { data: fallback } = await supabase
      .from("communication_templates")
      .select("body")
      .eq("event_key", eventKey)
      .eq("language", "en")
      .eq("is_current", true)
      .is("deleted_at", null)
      .maybeSingle();
    body = fallback?.body;
  }
  if (!body) return null;
  return renderTemplate(body, vars);
}

/** Envía un mensaje ya renderizado al canal YA REGISTRADO del successor (teléfono primero, email si no hay teléfono). Nunca acepta un canal distinto al guardado en trusted_successors. */
export async function sendToSuccessor(
  successor: TrustedSuccessorRow,
  body: string
): Promise<{ channel: "sms" | "email" | "none"; status: string }> {
  if (successor.contact_phone) {
    const result = await sendSms({ phoneNumber: successor.contact_phone, body });
    return { channel: "sms", status: result.status };
  }
  if (successor.contact_email) {
    const result = await sendEmail({
      toEmail: successor.contact_email,
      subject: "Lulu Island Flagship — Recuperación de acceso",
      body,
    });
    return { channel: "email", status: result.status };
  }
  return { channel: "none", status: "no_contact_on_file" };
}

/** Roles owner_admin activos con su email (auth.users), para emitir códigos de emergencia. Reusa exactamente admin_roles + auth.admin.getUserById, igual que src/app/api/admin/backup-codes/verify/route.ts. */
export async function getActiveOwnerAdmins(
  supabase: ServiceClient
): Promise<{ userId: string; email: string }[]> {
  const { data: roleRows } = await supabase
    .from("admin_roles")
    .select("user_id")
    .eq("role", "owner_admin")
    .is("deleted_at", null);

  const results: { userId: string; email: string }[] = [];
  for (const row of roleRows ?? []) {
    const { data: userData } = await supabase.auth.admin.getUserById(row.user_id);
    if (userData?.user?.email) {
      results.push({ userId: row.user_id, email: userData.user.email });
    }
  }
  return results;
}

// Código de emergencia emitido tras aprobación de recuperación de acceso --
// vida útil mucho más corta que un backup code generado a mano
// (BACKUP_CODE_TTL_DAYS = 90 días, src/lib/backup-codes.ts): este código se
// manda por SMS/email en el momento y se espera que se use enseguida, así
// que 1 hora es suficiente y limita la ventana de exposición si el mensaje
// se intercepta. Coincide con el texto ya existente en la plantilla
// 'access_recovery_emergency_code_issued' (203_e11_access_recovery_requests.sql):
// "expira en 1 hora, un solo uso".
const EMERGENCY_CODE_TTL_MS = 60 * 60 * 1000;

/**
 * Emite un código de respaldo de un solo uso por cada owner_admin activo,
 * REUSANDO owner_admin_backup_codes (194_e0_owner_admin_backup_codes.sql) y
 * generateBackupCode/hashBackupCode (src/lib/backup-codes.ts) -- exactamente
 * el mismo mecanismo construido en paralelo para el propio owner_admin, en
 * vez de duplicar una tabla/columnas nuevas de "código temporal". El código
 * en texto plano solo existe en memoria del servidor durante esta llamada.
 *
 * Fix (auditoría externa 2026-07-30, BUG 2): owner_admin_backup_codes ahora
 * tiene expires_at (migración 248_fix_owner_admin_backup_codes_expiry.sql) y
 * la verificación (POST /api/admin/backup-codes/verify) rechaza códigos
 * vencidos -- sin poblar expires_at aquí, todo código de emergencia quedaría
 * NULL y sería rechazado de inmediato como vencido. Se usa una TTL propia y
 * más corta (1h, EMERGENCY_CODE_TTL_MS) en vez de reusar
 * backupCodeExpiryIso() (90 días, pensado para códigos generados a mano por
 * el propio owner_admin) -- ya era la promesa hecha en la plantilla de
 * mensaje de este flujo, simplemente nunca se había implementado.
 */
export async function issueEmergencyAccessCodes(
  supabase: ServiceClient
): Promise<{ email: string; code: string }[]> {
  const admins = await getActiveOwnerAdmins(supabase);
  const issued: { email: string; code: string }[] = [];
  for (const admin of admins) {
    const code = generateBackupCode();
    const { error } = await supabase.from("owner_admin_backup_codes").insert({
      user_id: admin.userId,
      code_hash: hashBackupCode(code),
      expires_at: new Date(Date.now() + EMERGENCY_CODE_TTL_MS).toISOString(),
    });
    if (!error) {
      issued.push({ email: admin.email, code });
    } else {
      console.error("[access-recovery] issueEmergencyAccessCodes insert failed:", error.message);
    }
  }
  return issued;
}

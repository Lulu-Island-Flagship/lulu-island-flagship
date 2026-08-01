import { randomInt, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting, getHiringFlowServiceClient } from "./settings-service";
import { checkRateLimit } from "./rate-limiter";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 3: Autenticación y Seguridad Base.
//
// Tabla asumida (contrato acordado con la migración de Fase 2 que se está
// creando en paralelo):
//   access_codes(
//     id UUID,
//     candidate_id UUID,
//     code_hash TEXT,
//     purpose TEXT CHECK (purpose IN ('step2','step3')),
//     expires_at TIMESTAMPTZ,
//     used_at TIMESTAMPTZ,
//     created_at TIMESTAMPTZ
//   )
//
// El código NUNCA se guarda en texto plano, solo su hash (code_hash). El
// código en crudo únicamente existe de forma transitoria en memoria, en el
// valor de retorno de issueAccessCode(), para poder enviarlo por SMS/email
// una sola vez. No se loguea, no se persiste.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AccessCodesClient = SupabaseClient<any, "public", any>;

// ---------------------------------------------------------------------------
// generateRawCode — pura, testeable sin DB
// ---------------------------------------------------------------------------

// Alfabeto alfanumérico en mayúsculas sin caracteres ambiguos: se excluyen
// 0/O y 1/I porque un candidato leyendo el código en voz alta, o tipeándolo
// desde un SMS en una pantalla chica, los confunde fácilmente. Longitud 8
// para mantener un espacio de búsqueda grande (32^8 ≈ 1.1e12 combinaciones)
// dado que el código es de un solo uso pero puede tener varios días de
// vigencia (ver security_code_expiry_days), por lo que conviene resistir
// mejor un intento de fuerza bruta que un simple PIN numérico de 6 dígitos.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export function generateRawCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// hashCode — pura, testeable sin DB
// ---------------------------------------------------------------------------

// Usa node:crypto (stdlib), sin agregar ninguna dependencia nueva. SHA-256
// es suficiente aquí: el código en crudo ya tiene alta entropía (32^8) y
// vida corta (expira en días, se invalida tras el primer uso), por lo que
// no hace falta un KDF lento tipo bcrypt/argon2 pensado para passwords de
// baja entropía elegidas por humanos y de vida indefinida.
export function hashCode(rawCode: string): string {
  return createHash("sha256").update(rawCode, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

// Errores distintos y explícitos en vez de un "código inválido" genérico:
// facilita debugging interno y permite dar mejores mensajes al candidato
// (ej. "tu código expiró, pedí uno nuevo" vs "ese código ya fue usado").
export class AccessCodeInvalidError extends Error {
  constructor() {
    super("Access code invalid: no matching code_hash for this candidate/purpose");
    this.name = "AccessCodeInvalidError";
  }
}

export class AccessCodeExpiredError extends Error {
  constructor() {
    super("Access code expired: expires_at is in the past");
    this.name = "AccessCodeExpiredError";
  }
}

export class AccessCodeAlreadyUsedError extends Error {
  constructor() {
    super("Access code already used: used_at is set");
    this.name = "AccessCodeAlreadyUsedError";
  }
}

// Fix (auditoría externa, hallazgo confirmado): validateAccessCode() no
// tenía ningún límite de intentos -- un atacante (o un script con errores)
// podía probar códigos de 8 caracteres sin límite alguno contra el mismo
// candidateId/purpose. El espacio de búsqueda (32^8) hace fuerza bruta
// pura poco práctica, pero rate-limiter.ts (checkRateLimit) y el setting
// "security_rate_limit_validation" (sembrado en 254, descripción: "Máximo
// de intentos de validación (ej. código de seguridad) permitidos por
// candidato...") ya existían construidos exactamente para este caso de uso
// y no se estaban usando en ningún lado del módulo -- infraestructura
// muerta. Se conecta acá.
export class AccessCodeRateLimitedError extends Error {
  constructor() {
    super("Too many access code validation attempts. Please try again later.");
    this.name = "AccessCodeRateLimitedError";
  }
}

// ---------------------------------------------------------------------------
// Supabase client resolution — mismo patrón que settings-service
// ---------------------------------------------------------------------------

function resolveClient(client?: AccessCodesClient): AccessCodesClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a access_codes"
    );
  }
  return resolved;
}

export type AccessCodePurpose = "step2" | "step3";

interface AccessCodeRow {
  id: string;
  used_at: string | null;
  expires_at: string;
}

// ---------------------------------------------------------------------------
// issueAccessCode
// ---------------------------------------------------------------------------

export async function issueAccessCode(
  candidateId: string,
  purpose: AccessCodePurpose,
  client?: AccessCodesClient
): Promise<{ rawCode: string; expiresAt: Date }> {
  const resolved = resolveClient(client);

  // Nunca hardcodear días de expiración: viene de system_settings.
  const expiryDays = Number(
    await getSetting("security_code_expiry_days", resolved)
  );
  if (!Number.isFinite(expiryDays) || expiryDays <= 0) {
    throw new Error(
      `Invalid security_code_expiry_days setting: expected a positive number, got "${expiryDays}"`
    );
  }

  const rawCode = generateRawCode();
  const codeHash = hashCode(rawCode);
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

  const { error } = await resolved.from("access_codes").insert({
    candidate_id: candidateId,
    code_hash: codeHash,
    purpose,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`Failed to issue access code: ${error.message}`);
  }

  return { rawCode, expiresAt };
}

// ---------------------------------------------------------------------------
// validateAccessCode
// ---------------------------------------------------------------------------

// Solo valida y retorna el id de la fila; el caller decide cuándo llamar a
// markAccessCodeUsed(), para no acoplar la validación (lectura) con el
// side-effect (escritura) -- por ejemplo, un caller puede querer validar el
// código y solo marcarlo usado después de que el resto del paso se complete
// exitosamente.
export async function validateAccessCode(
  candidateId: string,
  rawCode: string,
  purpose: AccessCodePurpose,
  client?: AccessCodesClient
): Promise<{ accessCodeId: string }> {
  const resolved = resolveClient(client);

  // Rate limit ANTES de tocar access_codes -- ver AccessCodeRateLimitedError
  // arriba. Clave por candidato+propósito (no global ni solo por candidato)
  // para que agotar los intentos de un "step2" no bloquee accidentalmente
  // la validación de un código de "step3" del mismo candidato. Mismo
  // criterio fail-open que el resto de checkRateLimit(): si no se puede
  // leer el límite configurado, se deja pasar el tráfico en vez de romper
  // el flujo del candidato por un problema de configuración ajeno.
  const rateLimitKey = `hiring-flow:access-code-validate:${candidateId}:${purpose}`;
  const { allowed } = await checkRateLimit(
    rateLimitKey,
    "security_rate_limit_validation",
    resolved
  );
  if (!allowed) {
    throw new AccessCodeRateLimitedError();
  }

  const codeHash = hashCode(rawCode);

  const { data, error } = await resolved
    .from("access_codes")
    .select("id, used_at, expires_at")
    .eq("candidate_id", candidateId)
    .eq("purpose", purpose)
    .eq("code_hash", codeHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate access code: ${error.message}`);
  }

  const row = data as AccessCodeRow | null;
  if (!row) {
    throw new AccessCodeInvalidError();
  }

  if (row.used_at !== null) {
    throw new AccessCodeAlreadyUsedError();
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new AccessCodeExpiredError();
  }

  return { accessCodeId: row.id };
}

// ---------------------------------------------------------------------------
// markAccessCodeUsed
// ---------------------------------------------------------------------------

export async function markAccessCodeUsed(
  accessCodeId: string,
  client?: AccessCodesClient
): Promise<void> {
  const resolved = resolveClient(client);

  const { error } = await resolved
    .from("access_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", accessCodeId);

  if (error) {
    throw new Error(`Failed to mark access code as used: ${error.message}`);
  }
}

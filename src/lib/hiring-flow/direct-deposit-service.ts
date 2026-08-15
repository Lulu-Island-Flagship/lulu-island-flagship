import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 5.3 "Paso 3: Información Fiscal y Bancaria" -- Direct
// Deposit.
//
// A partir de la migración 284_hiring_flow_candidate_banking_info_encrypted.sql,
// esta tabla YA NO guarda transit/institution/account en texto plano --
// ver el comentario de cabecera de esa migración para el diseño completo
// (mismo patrón de pgcrypto ya usado y auditado en
// 204_e9_employee_sin_banking_encrypted.sql para employees). Este servicio
// nunca lee/escribe las columnas de la tabla directamente: todo pasa por
// las funciones RPC set_candidate_banking_info()/get_candidate_banking_info(),
// que cifran/descifran dentro de la misma transacción de Postgres.
//
// UNIQUE(candidate_id): un candidato tiene UNA sola fila de banking info
// vigente, corregible vía UPSERT (dentro del RPC), no un histórico
// inmutable -- ver comentario de la migración 279 para la distinción
// explícita frente a consents/electronic_signatures.

type BankingClient = SupabaseClient;

// ---------------------------------------------------------------------------
// Validadores puros -- sin DB, testeables directamente
// ---------------------------------------------------------------------------

// Transit number (branch number) canadiense: exactamente 5 dígitos.
export function isValidTransitNumber(value: string): boolean {
  return /^\d{5}$/.test(value);
}

// Institution number: exactamente 3 dígitos (identifica la institución
// financiera, ej. 001 = BMO, 003 = RBC, 002 = Scotiabank).
export function isValidInstitutionNumber(value: string): boolean {
  return /^\d{3}$/.test(value);
}

// Account number: entre 7 y 12 dígitos. No hay un estándar único
// canadiense para la longitud del número de cuenta (varía por banco) --
// este rango es un criterio razonable que cubre los formatos más comunes,
// no una regla normativa oficial. Se documenta como tal para que quede
// claro que no es una validación exhaustiva de "número de cuenta válido
// para ese banco específico".
export function isValidAccountNumber(value: string): boolean {
  return /^\d{7,12}$/.test(value);
}

// ---------------------------------------------------------------------------
// validateDirectDepositInput -- pura, acumula todos los errores
// ---------------------------------------------------------------------------

export interface DirectDepositInput {
  transitNumber: string;
  institutionNumber: string;
  accountNumber: string;
}

export interface DirectDepositFieldError {
  field: string;
  message: string;
}

// Función pura: nunca toca la DB, solo valida formato. Acumula TODOS los
// errores encontrados en vez de retornar en el primer fallo, para que el
// candidato pueda corregir todos los campos malos de una sola vez en el
// formulario en lugar de un ciclo de "corregir uno, reenviar, ver el
// siguiente error".
export function validateDirectDepositInput(
  input: DirectDepositInput
): DirectDepositFieldError[] {
  const errors: DirectDepositFieldError[] = [];

  if (!isValidTransitNumber(input.transitNumber)) {
    errors.push({
      field: "transitNumber",
      message: "El número de tránsito debe tener exactamente 5 dígitos",
    });
  }

  if (!isValidInstitutionNumber(input.institutionNumber)) {
    errors.push({
      field: "institutionNumber",
      message: "El número de institución debe tener exactamente 3 dígitos",
    });
  }

  if (!isValidAccountNumber(input.accountNumber)) {
    errors.push({
      field: "accountNumber",
      message: "El número de cuenta debe tener entre 7 y 12 dígitos",
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export class DirectDepositValidationError extends Error {
  public readonly fieldErrors: DirectDepositFieldError[];

  constructor(fieldErrors: DirectDepositFieldError[]) {
    super(
      `Direct deposit validation failed: ${fieldErrors
        .map((e) => `${e.field}: ${e.message}`)
        .join("; ")}`
    );
    this.name = "DirectDepositValidationError";
    this.fieldErrors = fieldErrors;
  }
}

// ---------------------------------------------------------------------------
// Supabase client resolution -- mismo patrón que el resto del módulo
// ---------------------------------------------------------------------------

function resolveClient(client?: BankingClient): BankingClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a candidate_banking_info"
    );
  }
  return resolved;
}

// Única fuente de verdad de la clave de cifrado (ver migración 284 para el
// diseño completo -- mismo criterio que PAYROLL_ENCRYPTION_KEY para
// employees, pero deliberadamente una variable de entorno DISTINTA: son
// dominios de confianza separados). Nunca hardcodeada, nunca con fallback
// silencioso -- "regla de oro de seguridad": si falta, la función que la
// necesita debe fallar de forma segura (throw), no simular un cifrado que
// no ocurrió.
export class HiringFlowEncryptionKeyMissingError extends Error {
  constructor() {
    super(
      "HIRING_FLOW_ENCRYPTION_KEY no configurada del lado servidor: no se pueden cifrar/descifrar datos bancarios de candidatos. Ver comentario de cabecera de la migración 284 para instrucciones de configuración."
    );
    this.name = "HiringFlowEncryptionKeyMissingError";
  }
}

export type GetHiringFlowEncryptionKeyFn = () => string;

function defaultGetHiringFlowEncryptionKey(): string {
  const key = process.env.HIRING_FLOW_ENCRYPTION_KEY;
  if (!key) {
    throw new HiringFlowEncryptionKeyMissingError();
  }
  return key;
}

interface SetBankingInfoRpcRow {
  set_candidate_banking_info: string;
}

interface GetBankingInfoRpcRow {
  transit_number: string | null;
  institution_number: string | null;
  account_number: string | null;
}

// ---------------------------------------------------------------------------
// setCandidateDirectDeposit
// ---------------------------------------------------------------------------

// Valida primero (función pura, sin efectos secundarios); si falla, lanza
// DirectDepositValidationError y NUNCA toca la DB. Solo si la validación
// pasa se llama a la RPC set_candidate_banking_info (284), que cifra y
// hace UPSERT dentro de la misma transacción de Postgres -- por el
// UNIQUE(candidate_id) de la migración 279, una segunda llamada para el
// mismo candidato actualiza la fila existente en vez de acumular
// históricas (a diferencia de consents/electronic_signatures, ver
// justificación en esa migración).
export async function setCandidateDirectDeposit(
  candidateId: string,
  input: DirectDepositInput,
  client?: BankingClient,
  getEncryptionKeyFn: GetHiringFlowEncryptionKeyFn = defaultGetHiringFlowEncryptionKey
): Promise<{ id: string }> {
  const fieldErrors = validateDirectDepositInput(input);
  if (fieldErrors.length > 0) {
    throw new DirectDepositValidationError(fieldErrors);
  }

  const resolved = resolveClient(client);
  const encryptionKey = getEncryptionKeyFn();

  const { data, error } = await resolved.rpc("set_candidate_banking_info", {
    p_candidate_id: candidateId,
    p_transit_number: input.transitNumber,
    p_institution_number: input.institutionNumber,
    p_account_number: input.accountNumber,
    p_encryption_key: encryptionKey,
  });

  if (error) {
    throw new Error(
      `Failed to upsert encrypted direct deposit info for candidate "${candidateId}": ${error.message}`
    );
  }

  // set_candidate_banking_info RETURNS UUID (escalar) -- llega como el
  // valor directo, no envuelto en fila/array, a diferencia de las RPCs
  // RETURNS TABLE de este módulo (ej. submit_step1_candidate).
  const id = data as unknown as SetBankingInfoRpcRow["set_candidate_banking_info"] | null;
  if (!id) {
    throw new Error(
      `set_candidate_banking_info RPC returned no id for candidate "${candidateId}"`
    );
  }

  return { id };
}

// ---------------------------------------------------------------------------
// getCandidateDirectDeposit
// ---------------------------------------------------------------------------

export async function getCandidateDirectDeposit(
  candidateId: string,
  client?: BankingClient,
  getEncryptionKeyFn: GetHiringFlowEncryptionKeyFn = defaultGetHiringFlowEncryptionKey
): Promise<DirectDepositInput | null> {
  const resolved = resolveClient(client);
  const encryptionKey = getEncryptionKeyFn();

  const { data, error } = await resolved.rpc("get_candidate_banking_info", {
    p_candidate_id: candidateId,
    p_encryption_key: encryptionKey,
  });

  if (error) {
    throw new Error(
      `Failed to fetch/decrypt direct deposit info for candidate "${candidateId}": ${error.message}`
    );
  }

  // get_candidate_banking_info RETURNS TABLE -> data llega como array de
  // filas (0 o 1). Si el candidato no tiene banking info todavía, la RPC
  // no devuelve ninguna fila (RETURN sin RETURN QUERY dentro del IF NOT
  // FOUND) -- se mapea a null, igual que el comportamiento anterior con
  // maybeSingle().
  const rows = data as unknown as GetBankingInfoRpcRow[] | null;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.transit_number === null) {
    return null;
  }

  return {
    transitNumber: row.transit_number as string,
    institutionNumber: row.institution_number as string,
    accountNumber: row.account_number as string,
  };
}

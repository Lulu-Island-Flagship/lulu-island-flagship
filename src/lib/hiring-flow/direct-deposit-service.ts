import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 5.3 "Paso 3: Información Fiscal y Bancaria" -- Direct
// Deposit.
//
// Tabla asumida (contrato acordado con la migración
// 279_hiring_flow_candidate_banking_info.sql, creada junto con este
// archivo):
//   candidate_banking_info(
//     id UUID,
//     candidate_id UUID UNIQUE,
//     transit_number TEXT,
//     institution_number TEXT,
//     account_number TEXT,
//     created_at TIMESTAMPTZ,
//     updated_at TIMESTAMPTZ
//   )
//
// [WARNING] esta tabla guarda los datos bancarios en texto plano -- ver el
// comentario de cabecera de la migración 279 para el análisis de riesgo
// completo. Este servicio no agrega cifrado adicional; solo valida el
// formato antes de persistir.
//
// UNIQUE(candidate_id): un candidato tiene UNA sola fila de banking info
// vigente, corregible vía UPDATE (UPSERT), no un histórico inmutable --
// ver comentario de la migración 279 para la distinción explícita frente
// a consents/electronic_signatures.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BankingClient = SupabaseClient<any, "public", any>;

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

interface CandidateBankingInfoRow {
  id: string;
  candidate_id: string;
  transit_number: string;
  institution_number: string;
  account_number: string;
}

// ---------------------------------------------------------------------------
// setCandidateDirectDeposit
// ---------------------------------------------------------------------------

// Valida primero (función pura, sin efectos secundarios); si falla, lanza
// DirectDepositValidationError y NUNCA toca la DB. Solo si la validación
// pasa se hace el UPSERT sobre candidate_banking_info -- por el
// UNIQUE(candidate_id) de la migración 279, onConflict: 'candidate_id'
// actualiza la fila existente en vez de acumular históricas (a diferencia
// de consents/electronic_signatures, ver justificación en esa migración).
export async function setCandidateDirectDeposit(
  candidateId: string,
  input: DirectDepositInput,
  client?: BankingClient
): Promise<{ id: string }> {
  const fieldErrors = validateDirectDepositInput(input);
  if (fieldErrors.length > 0) {
    throw new DirectDepositValidationError(fieldErrors);
  }

  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("candidate_banking_info")
    .upsert(
      {
        candidate_id: candidateId,
        transit_number: input.transitNumber,
        institution_number: input.institutionNumber,
        account_number: input.accountNumber,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "candidate_id" }
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to upsert direct deposit info for candidate "${candidateId}": ${
        error?.message ?? "no data returned"
      }`
    );
  }

  return { id: (data as { id: string }).id };
}

// ---------------------------------------------------------------------------
// getCandidateDirectDeposit
// ---------------------------------------------------------------------------

export async function getCandidateDirectDeposit(
  candidateId: string,
  client?: BankingClient
): Promise<DirectDepositInput | null> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("candidate_banking_info")
    .select("id, candidate_id, transit_number, institution_number, account_number")
    .eq("candidate_id", candidateId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to fetch direct deposit info for candidate "${candidateId}": ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  const row = data as CandidateBankingInfoRow;
  return {
    transitNumber: row.transit_number,
    institutionNumber: row.institution_number,
    accountNumber: row.account_number,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { getHiringFlowServiceClient } from "./settings-service";

// Módulo nuevo y separado: flujo de contratación v0.4.1 (candidate hiring
// flow). Fase 5.1: "Paso 2: Disponibilidad y Documentos".
//
// Tabla usada (ver supabase/migrations/258_hiring_flow_candidate_availability.sql,
// Fase 2, ya aplicada -- NO se crea ni se edita aquí):
//   candidate_availability(
//     id UUID,
//     candidate_id UUID,
//     day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
//     start_time TIME,
//     end_time TIME,
//     created_at TIMESTAMPTZ
//   )
//
// Convención de day_of_week (documentada también en la migración 258):
// 0=domingo..6=sábado, igual que `Date.getDay()` en JS/Postgres `EXTRACT
// (DOW FROM ...)`. No es ISO-8601 (que usaría 1=lunes..7=domingo) -- se
// elige esta convención porque es la que ya usa la migración y evita un
// mapeo adicional en el servicio.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AvailabilityClient = SupabaseClient<any, "public", any>;

export interface AvailabilityBlockInput {
  // 0=domingo..6=sábado (ver nota de convención arriba).
  dayOfWeek: number;
  // "HH:MM" 24h, ej. "09:00", "17:30".
  startTime: string;
  endTime: string;
}

export interface AvailabilityFieldError {
  field: string;
  message: string;
}

export class AvailabilityValidationError extends Error {
  readonly errors: AvailabilityFieldError[];

  constructor(errors: AvailabilityFieldError[]) {
    const fields = errors.map((e) => e.field).join(", ");
    super(`Candidate availability failed validation: ${fields}`);
    this.name = "AvailabilityValidationError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Validación pura (sin DB) -- misma filosofía que step1-validator.ts.
// ---------------------------------------------------------------------------

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

// Valida UN bloque de forma aislada -- no sabe nada de otros bloques (el
// solapamiento entre bloques es responsabilidad de validateAvailabilityBlocks,
// que sí tiene el conjunto completo).
export function validateAvailabilityBlock(
  input: AvailabilityBlockInput
): AvailabilityFieldError[] {
  // Acumula TODOS los errores en vez de retornar en el primero (regla del
  // proyecto para validaciones de objetos compuestos, ver step1-validator.ts).
  const errors: AvailabilityFieldError[] = [];

  if (
    typeof input.dayOfWeek !== "number" ||
    !Number.isInteger(input.dayOfWeek) ||
    input.dayOfWeek < 0 ||
    input.dayOfWeek > 6
  ) {
    errors.push({
      field: "dayOfWeek",
      message: "dayOfWeek must be an integer between 0 (Sunday) and 6 (Saturday)",
    });
  }

  const startTime = input.startTime ?? "";
  const startTimeValid = TIME_PATTERN.test(startTime);
  if (!startTimeValid) {
    errors.push({
      field: "startTime",
      message: 'startTime must be a valid 24h time in "HH:MM" format (00:00-23:59)',
    });
  }

  const endTime = input.endTime ?? "";
  const endTimeValid = TIME_PATTERN.test(endTime);
  if (!endTimeValid) {
    errors.push({
      field: "endTime",
      message: 'endTime must be a valid 24h time in "HH:MM" format (00:00-23:59)',
    });
  }

  // Solo compara los horarios entre sí si ambos son formatos válidos --
  // comparar un "HH:MM" inválido no aporta información adicional y ya
  // generó su propio error arriba.
  if (startTimeValid && endTimeValid) {
    // Estrictamente después: un bloque de 0 minutos (startTime === endTime)
    // no tiene sentido para disponibilidad de un candidato, igual que un
    // bloque invertido (endTime antes que startTime).
    if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      errors.push({
        field: "endTime",
        message: "endTime must be strictly after startTime",
      });
    }
  }

  return errors;
}

// Dos bloques (mismo día, ya validados individualmente) se solapan si el
// inicio de uno es estrictamente anterior al fin del otro, en ambos
// sentidos -- fórmula estándar de intersección de intervalos [start, end).
function blocksOverlap(a: AvailabilityBlockInput, b: AvailabilityBlockInput): boolean {
  const aStart = timeToMinutes(a.startTime);
  const aEnd = timeToMinutes(a.endTime);
  const bStart = timeToMinutes(b.startTime);
  const bEnd = timeToMinutes(b.endTime);
  return aStart < bEnd && bStart < aEnd;
}

export function validateAvailabilityBlocks(
  inputs: AvailabilityBlockInput[]
): AvailabilityFieldError[] {
  const errors: AvailabilityFieldError[] = [];

  // Paso 1: validar cada bloque individualmente, prefijando el índice al
  // field (ej. "blocks[2].startTime") para que el caller HTTP pueda mapear
  // el error de vuelta al bloque exacto que lo causó.
  inputs.forEach((input, index) => {
    const blockErrors = validateAvailabilityBlock(input);
    for (const err of blockErrors) {
      errors.push({ field: `blocks[${index}].${err.field}`, message: err.message });
    }
  });

  // Paso 2: detectar solapamientos entre bloques del MISMO día. Solo tiene
  // sentido comparar bloques que ya pasaron su propia validación individual
  // (start/end con formato válido y end > start) -- comparar un bloque roto
  // produciría falsos positivos/negativos sin aportar señal nueva.
  const validIndices = inputs
    .map((input, index) => ({ input, index }))
    .filter(({ input }) => validateAvailabilityBlock(input).length === 0);

  for (let i = 0; i < validIndices.length; i++) {
    for (let j = i + 1; j < validIndices.length; j++) {
      const a = validIndices[i];
      const b = validIndices[j];
      // El solape solo importa dentro del MISMO día -- dos bloques en días
      // distintos que "se pisan en horario" (ej. lunes 9-17 y martes 9-17)
      // son perfectamente normales y NO deben marcarse como error.
      if (a.input.dayOfWeek !== b.input.dayOfWeek) continue;
      if (blocksOverlap(a.input, b.input)) {
        errors.push({
          field: "blocks",
          message: `blocks[${a.index}] and blocks[${b.index}] overlap on day ${a.input.dayOfWeek}`,
        });
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function resolveClient(client?: AvailabilityClient): AvailabilityClient {
  const resolved = client ?? getHiringFlowServiceClient();
  if (!resolved) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no configurado: no se puede acceder a candidate_availability"
    );
  }
  return resolved;
}

interface CandidateAvailabilityRow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

// Reemplaza (delete + insert) la disponibilidad completa del candidato.
//
// Fix (auditoría externa, hallazgo confirmado): la versión anterior de esta
// función hacía DELETE y luego INSERT como dos llamadas independientes a
// supabase-js -- NO una transacción de Postgres real. Si el proceso moría o
// la conexión se cortaba justo entre el delete y el insert, el candidato
// podía quedar temporalmente SIN ninguna fila de disponibilidad. Aunque el
// riesgo era bajo (a diferencia de candidates+consents, esto no es un
// requisito legal -- el candidato puede volver a enviarlo), se cierra la
// ventana de todos modos con el mismo patrón ya usado en el resto del
// módulo: una función RPC SECURITY DEFINER (285_hiring_flow_
// set_candidate_availability_atomic.sql) que hace DELETE + INSERT dentro
// de una sola transacción real. Los bloques ya validados en TS
// (validateAvailabilityBlocks arriba) viajan como JSONB -- la RPC no
// revalida formato, solo persiste.
export async function setCandidateAvailability(
  candidateId: string,
  blocks: AvailabilityBlockInput[],
  client?: AvailabilityClient
): Promise<{ count: number }> {
  const validationErrors = validateAvailabilityBlocks(blocks);
  if (validationErrors.length > 0) {
    // Nunca toca la DB si la validación falla.
    throw new AvailabilityValidationError(validationErrors);
  }

  const resolved = resolveClient(client);

  const { data, error } = await resolved.rpc("set_candidate_availability", {
    p_candidate_id: candidateId,
    p_blocks: blocks.map((block) => ({
      day_of_week: block.dayOfWeek,
      start_time: block.startTime,
      end_time: block.endTime,
    })),
  });

  if (error) {
    throw new Error(
      `Failed to set availability for candidate "${candidateId}": ${error.message}`
    );
  }

  return { count: typeof data === "number" ? data : 0 };
}

export async function getCandidateAvailability(
  candidateId: string,
  client?: AvailabilityClient
): Promise<AvailabilityBlockInput[]> {
  const resolved = resolveClient(client);

  const { data, error } = await resolved
    .from("candidate_availability")
    .select("day_of_week, start_time, end_time")
    .eq("candidate_id", candidateId)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load availability for candidate "${candidateId}": ${error.message}`
    );
  }

  return (data ?? []).map((row: CandidateAvailabilityRow) => ({
    dayOfWeek: row.day_of_week,
    // TIME de Postgres puede llegar como "HH:MM:SS" -- se normaliza a
    // "HH:MM" para que el shape de salida sea siempre consistente con
    // AvailabilityBlockInput, sin importar el formato exacto que devuelva
    // el driver.
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
  }));
}

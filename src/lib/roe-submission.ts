/**
 * v8.5 Capa 6 del Financial Core — ROE Submission orchestrator.
 *
 * Orquesta la generación, validación, y registro de Records of Employment
 * (ROE) para empleados terminados. Conecta la base de datos (empleados,
 * payroll_linea, payroll_ciclo) con las funciones puras de roe-generator.ts.
 *
 * Funciones:
 *   - prepareRoe(): pipeline completo: fetch → generate → validate → record
 *   - getPendingRoes(): empleados terminados sin ROE emitido
 *   - getSubmissionDeadline(): 5 días calendario post fin de período de pago
 *   - recordRoeSubmission(): registra el envío en la BD
 *
 * REGLA: SIN nunca completo en logs — solo últimos 3 dígitos visibles.
 * Todos los montos en centavos enteros (CAD).
 *
 * Interconexiones:
 *   roe-submission.ts ──(usa)──→ roe-generator.ts (generateRoe, generateRoeXml, …)
 *   roe-submission.ts ──(usa)──→ payroll-line.ts (maskSin)
 *   roe-submission.ts ──(usado por)──→ src/app/api/admin/payroll/roe/route.ts
 */

import { createHash } from "@/lib/crypto.server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateRoe,
  generateRoeXml,
  validateRoeXml,
  aggregatePayPeriodsForRoe,
  type RoeInput,
  type RoeTerminationCode,
  type RoePayPeriod,
  type RecordOfEmployment,
  type RoeXmlValidationResult,
} from "./roe-generator";
import { maskSin } from "./payroll-line";

// =========================================================================
// ROE Submission Result
// =========================================================================

/** Resultado de una operación de generación/validación de ROE. */
export interface RoeSubmissionResult {
  /** UUID del empleado. */
  employeeId: string;
  /** Número de serie del ROE generado. */
  serialNumber: string;
  /** ROE completo (estructura de 53 boxes). */
  roe: RecordOfEmployment;
  /** XML generado para Service Canada ROE Web. */
  xml: string;
  /** Resultado de validación del XML. */
  validation: RoeXmlValidationResult;
  /** Timestamp de generación (ISO 8601). */
  generatedAt: string;
  /** Hash SHA-256 del XML para integridad. */
  contentHash: string;
}

/** Resultado de registrar un envío de ROE en la base de datos. */
export interface RoeRecordResult {
  /** true si se registró exitosamente. */
  recorded: boolean;
  /** ID del registro en roe_submissions (si existe). */
  submissionId?: string;
  /** Error si falló el registro. */
  error?: string;
}

// =========================================================================
// Pending ROE — empleados que necesitan ROE
// =========================================================================

/** Un empleado que necesita ROE (terminado, sin ROE emitido). */
export interface PendingRoe {
  /** UUID del empleado. */
  employeeId: string;
  /** Nombre legal del empleado. */
  employeeName: string;
  /** Fecha de terminación (YYYY-MM-DD). */
  terminationDate: string;
  /** Último día trabajado (YYYY-MM-DD). */
  lastDayWorked: string;
}

// =========================================================================
// getSubmissionDeadline()
// =========================================================================

/**
 * Calcula la fecha límite de envío del ROE según las reglas de Service Canada.
 *
 * Regla: el ROE debe emitirse dentro de los 5 días calendario posteriores
 * al fin del período de pago en el que ocurrió la interrupción de ingresos
 * (o 5 días después de que el empleador toma conocimiento de la interrupción,
 * lo que ocurra primero).
 *
 * Para Lulu Island: usamos la fecha de terminación + 5 días calendario
 * como deadline conservador. Si el último período de pago terminó después
 * de la fecha de terminación, se usa el fin del período + 5 días.
 *
 * @param terminationDate — fecha de terminación (YYYY-MM-DD).
 * @param finalPayPeriodEnd — fecha de fin del último período de pago
 *   (YYYY-MM-DD). Si no se provee, se usa terminationDate.
 * @returns Fecha límite (YYYY-MM-DD).
 */
export function getSubmissionDeadline(
  terminationDate: string,
  finalPayPeriodEnd?: string,
): string {
  // Usar la fecha más tardía entre terminación y fin del período de pago
  const base = finalPayPeriodEnd &&
    finalPayPeriodEnd > terminationDate
    ? finalPayPeriodEnd
    : terminationDate;

  const d = new Date(base + "T12:00:00-08:00"); // mediodía PT para evitar problemas de zona
  d.setDate(d.getDate() + 5); // 5 días calendario

  return d.toISOString().slice(0, 10);
}

// =========================================================================
// getPendingRoes()
// =========================================================================

/**
 * Obtiene la lista de empleados que necesitan ROE: aquellos que están
 * terminados (`terminated_at` no nulo) y no tienen un ROE registrado
 * en la tabla `roe_submissions`.
 *
 * @param supabase — cliente Supabase con service_role (sin RLS).
 * @returns Array de {employeeId, employeeName, terminationDate, lastDayWorked}.
 */
export async function getPendingRoes(
  supabase: SupabaseClient,
): Promise<PendingRoe[]> {
  const { data: roeEmployeeIds, error: roeError } = await supabase
    .from("roe_submissions")
    .select("employee_id");

  if (roeError) {
    console.error("getPendingRoes: error fetching roe_submissions", roeError);
    throw new Error("Failed to fetch ROE submissions");
  }

  const alreadyIssued = new Set(
    (roeEmployeeIds ?? []).map((r: { employee_id: string }) => r.employee_id),
  );

  const { data: employees, error: empError } = await supabase
    .from("employees")
    .select("id, name, terminated_at")
    .not("terminated_at", "is", null)
    .order("terminated_at", { ascending: false });

  if (empError) {
    console.error("getPendingRoes: error fetching employees", empError);
    throw new Error("Failed to fetch terminated employees");
  }

  const pending: PendingRoe[] = [];

  for (const emp of employees ?? []) {
    if (alreadyIssued.has(emp.id)) continue;

    // lastDayWorked ≈ terminated_at para propósitos del ROE
    // (el caller puede refinarlo si tiene datos más precisos)
    const termDate = (emp.terminated_at as string).slice(0, 10);

    pending.push({
      employeeId: emp.id,
      employeeName: emp.name,
      terminationDate: termDate,
      lastDayWorked: termDate,
    });
  }

  return pending;
}

// =========================================================================
// prepareRoe()
// =========================================================================

/**
 * Orquesta la generación completa de un Record of Employment: obtiene los
 * datos del empleado y sus períodos de pago de la base de datos, construye
 * el `RoeInput`, genera el ROE y el XML, lo valida, y registra el envío.
 *
 * Pipeline:
 *   1. Fetch employee data (name, address, SIN, hire_date, terminated_at)
 *   2. Fetch pay periods (payroll_linea + payroll_ciclo, últimas 52 semanas)
 *   3. Build RoeInput
 *   4. generateRoe() → RecordOfEmployment
 *   5. generateRoeXml() → XML string
 *   6. validateRoeXml() → validation result
 *   7. recordRoeSubmission() → persistir en BD
 *
 * @param supabase — cliente Supabase con service_role (sin RLS).
 * @param employeeId — UUID del empleado.
 * @param terminationCode — código de motivo Service Canada (A, E, K, M, N, …).
 * @param lastDayWorked — último día trabajado (YYYY-MM-DD).
 *   Si no se provee, se usa `terminated_at` del empleado.
 * @param comments — comentarios opcionales (Block 18).
 * @returns RoeSubmissionResult con ROE, XML, validación, y hash.
 *
 * @throws {Error} si el empleado no existe, no tiene SIN, o no tiene
 *   períodos de pago en las últimas 52 semanas.
 */
export async function prepareRoe(
  supabase: SupabaseClient,
  employeeId: string,
  terminationCode: RoeTerminationCode,
  lastDayWorked?: string,
  comments?: string,
): Promise<RoeSubmissionResult> {
  // ── 1. Fetch employee data ──────────────────────────────────────────────
  const { data: employee, error: empError } = await supabase
    .from("employees")
    .select("id, name, email, hire_date, terminated_at, created_at")
    .eq("id", employeeId)
    .single();

  if (empError || !employee) {
    throw new Error(
      `Empleado ${employeeId.slice(0, 8)}… no encontrado: ${empError?.message ?? "not found"}`,
    );
  }

  if (!employee.terminated_at) {
    throw new Error(
      `Empleado ${employeeId.slice(0, 8)}… no está terminado (terminated_at es null).`,
    );
  }

  // ── 2. Fetch SIN (descifrado vía RPC, solo service_role) ───────────────
  let sinDecrypted = "";
  try {
    const { data: sinData, error: sinError } = await supabase.rpc(
      "get_employee_sin",
      { employee_uuid: employeeId },
    );

    if (sinError) {
      // RPC puede no existir todavía; fallback controlado
      console.error(
        `prepareRoe: RPC get_employee_sin falló para empleado ${employeeId.slice(0, 8)}… — ${sinError.message}`,
      );
    } else if (typeof sinData === "string" && sinData.length === 9) {
      sinDecrypted = sinData;
    }
  } catch {
    console.error(
      `prepareRoe: RPC get_employee_sin no disponible para empleado ${employeeId.slice(0, 8)}…`,
    );
  }

  if (!sinDecrypted) {
    throw new Error(
      `SIN no disponible para empleado ${employeeId.slice(0, 8)}…. ` +
        `Verificar que get_employee_sin RPC esté configurada y el empleado tenga SIN registrado.`,
    );
  }

  // ── 3. Fetch employee address ──────────────────────────────────────────
  // Intentar tabla employee_addresses; si no existe, usar address del
  // employer como fallback documentado (el empleador debe corregir).
  let employeeAddress: RoeInput["employeeAddress"] = {
    line1: "Address on file — contact payroll",
    city: "Richmond",
    province: "BC",
    postalCode: "V6X 0A0",
  };

  try {
    const { data: addrData, error: addrError } = await supabase
      .from("employee_addresses")
      .select("line1, line2, city, province, postal_code")
      .eq("employee_id", employeeId)
      .maybeSingle();

    if (!addrError && addrData) {
      employeeAddress = {
        line1: addrData.line1 ?? employeeAddress.line1,
        line2: addrData.line2 ?? undefined,
        city: addrData.city ?? employeeAddress.city,
        province: addrData.province ?? employeeAddress.province,
        postalCode: addrData.postal_code ?? employeeAddress.postalCode,
      };
    }
  } catch {
    // Tabla puede no existir — usar fallback
  }

  // ── 4. Fetch pay periods (últimas 52 semanas) ──────────────────────────
  const payPeriods = await fetchPayPeriodsForEmployee(supabase, employeeId);

  if (payPeriods.length === 0) {
    throw new Error(
      `Empleado ${employeeId.slice(0, 8)}… no tiene períodos de pago en las últimas 52 semanas.`,
    );
  }

  // ── 5. Determinar fechas ────────────────────────────────────────────────
  const terminationDate = (employee.terminated_at as string).slice(0, 10);
  const firstDayWorked = employee.hire_date
    ? (employee.hire_date as string).slice(0, 10)
    : (employee.created_at as string).slice(0, 10);
  const effectiveLastDay =
    lastDayWorked ?? terminationDate;

  // Período final = el más reciente (payPeriods[0])
  const finalPeriod = payPeriods[0];

  // ── 6. Build RoeInput ──────────────────────────────────────────────────
  const input: RoeInput = {
    employeeId,
    employeeLegalName: employee.name,
    employeeAddress,
    sin: sinDecrypted,
    firstDayWorked,
    lastDayWorked: effectiveLastDay,
    terminationDate,
    terminationCode,
    payPeriods,
    finalPayPeriodStart: finalPeriod.periodStart,
    finalPayPeriodEnd: finalPeriod.periodEnd,
    deliveryMethod: "electronic",
    comments: comments ?? undefined,
  };

  // ── 7. Generate ROE ────────────────────────────────────────────────────
  const roe = generateRoe(input);

  // ── 8. Generate XML ────────────────────────────────────────────────────
  const xml = generateRoeXml(roe, sinDecrypted);

  // ── 9. Validate XML ────────────────────────────────────────────────────
  const validation = validateRoeXml(xml);

  // ── 10. Compute content hash ───────────────────────────────────────────
  const contentHash = createHash("sha256").update(xml, "utf8").digest("hex");
  const generatedAt = new Date().toISOString();

  // ── 11. Record submission ──────────────────────────────────────────────
  const recordResult = await recordRoeSubmission(supabase, {
    employeeId,
    serialNumber: roe.serialNumber,
    terminationCode: roe.terminationCode,
    terminationDate: roe.terminationDate,
    totalInsurableEarningsCents: roe.totalInsurableEarningsCents,
    totalInsurableHours: roe.totalInsurableHours,
    xmlContent: xml,
    contentHash,
    validationValid: validation.valid,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
    generatedAt,
  });

  // Log seguro: SIN enmascarado
  console.log(
    `ROE generated: serial=${roe.serialNumber}, ` +
      `employee=${employeeId.slice(0, 8)}…, ` +
      `SIN=${maskSin(sinDecrypted)}, ` +
      `code=${roe.terminationCode}, ` +
      `valid=${validation.valid}, ` +
      `recorded=${recordResult.recorded}` +
      (recordResult.submissionId ? `, submissionId=${recordResult.submissionId}` : ""),
  );

  return {
    employeeId,
    serialNumber: roe.serialNumber,
    roe,
    xml,
    validation,
    generatedAt,
    contentHash,
  };
}

// =========================================================================
// recordRoeSubmission()
// =========================================================================

/** Datos para registrar un envío de ROE en la base de datos. */
export interface RoeSubmissionRecord {
  employeeId: string;
  serialNumber: string;
  terminationCode: string;
  terminationDate: string;
  totalInsurableEarningsCents: number;
  totalInsurableHours: number;
  xmlContent: string;
  contentHash: string;
  validationValid: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  generatedAt: string;
}

/**
 * Registra un ROE generado en la tabla `roe_submissions`.
 *
 * Esta función asume que la tabla `roe_submissions` existe con las columnas
 * necesarias. Si la tabla no existe, el error se captura y se devuelve
 * `recorded: false`.
 *
 * @param supabase — cliente Supabase con service_role.
 * @param record — datos del ROE a registrar.
 * @returns RoeRecordResult con el resultado del insert.
 */
export async function recordRoeSubmission(
  supabase: SupabaseClient,
  record: RoeSubmissionRecord,
): Promise<RoeRecordResult> {
  try {
    const { data, error } = await supabase
      .from("roe_submissions")
      .insert({
        employee_id: record.employeeId,
        serial_number: record.serialNumber,
        termination_code: record.terminationCode,
        termination_date: record.terminationDate,
        total_insurable_earnings_cents: record.totalInsurableEarningsCents,
        total_insurable_hours: record.totalInsurableHours,
        xml_content: record.xmlContent,
        content_hash: record.contentHash,
        validation_valid: record.validationValid,
        validation_errors: record.validationErrors,
        validation_warnings: record.validationWarnings,
        generated_at: record.generatedAt,
      })
      .select("id")
      .single();

    if (error) {
      console.error("recordRoeSubmission: insert failed", error);
      return { recorded: false, error: error.message };
    }

    return {
      recorded: true,
      submissionId: (data as { id: string } | null)?.id,
    };
  } catch (err) {
    console.error("recordRoeSubmission: unexpected error", err);
    return {
      recorded: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

// =========================================================================
// fetchPayPeriodsForEmployee()
// =========================================================================

/**
 * Obtiene los períodos de pago de un empleado para las últimas 52 semanas
 * desde las tablas `payroll_linea` y `payroll_ciclo`.
 *
 * @param supabase — cliente Supabase con service_role.
 * @param employeeId — UUID del empleado.
 * @returns Array de RoePayPeriod ordenados del más reciente al más antiguo.
 * @internal — llamado solo por prepareRoe().
 */
async function fetchPayPeriodsForEmployee(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<RoePayPeriod[]> {
  // Ventana: últimas 53 semanas (1 extra para margen)
  const fiftyThreeWeeksAgo = new Date();
  fiftyThreeWeeksAgo.setDate(fiftyThreeWeeksAgo.getDate() - 53 * 7);
  const cutoffDate = fiftyThreeWeeksAgo.toISOString().slice(0, 10);

  // 1. Fetch payroll_linea rows for this employee
  const { data: lineas, error: lineasError } = await supabase
    .from("payroll_linea")
    .select("ciclo_id, gross_cents, vacation_pay_cents")
    .eq("employee_id", employeeId);

  if (lineasError) {
    console.error(
      `fetchPayPeriodsForEmployee: error fetching payroll_linea for ${employeeId.slice(0, 8)}…`,
      lineasError,
    );
    return [];
  }

  if (!lineas || lineas.length === 0) {
    return [];
  }

  // 2. Fetch corresponding payroll_ciclo rows
  const cicloIds = [...new Set(lineas.map((l: { ciclo_id: string }) => l.ciclo_id))];

  const { data: ciclos, error: ciclosError } = await supabase
    .from("payroll_ciclo")
    .select("ciclo_id, fecha_inicio, fecha_fin, fecha_pago")
    .in("ciclo_id", cicloIds)
    .gte("fecha_inicio", cutoffDate);

  if (ciclosError) {
    console.error(
      `fetchPayPeriodsForEmployee: error fetching payroll_ciclo for ${employeeId.slice(0, 8)}…`,
      ciclosError,
    );
    return [];
  }

  // 3. Build ciclo lookup
  const cicloMap = new Map<string, { start: string; end: string; payDate: string }>();
  for (const c of ciclos ?? []) {
    cicloMap.set(c.ciclo_id, {
      start: (c.fecha_inicio as string).slice(0, 10),
      end: (c.fecha_fin as string).slice(0, 10),
      payDate: (c.fecha_pago as string).slice(0, 10),
    });
  }

  // 4. Aggregate using existing helper
  // Map DB rows to the shape expected by aggregatePayPeriodsForRoe.
  // horas_extra_cents is not available at this level; default to 0.
  const aggregated = aggregatePayPeriodsForRoe(
    (lineas as { ciclo_id: string; gross_cents: number }[]).map((l) => ({
      ciclo_id: l.ciclo_id,
      gross_cents: l.gross_cents,
      horas_extra_cents: 0,
    })),
    cicloMap,
  );

  return aggregated;
}

// =========================================================================
// SQL Schema — roe_submissions table
// =========================================================================

/**
 * ─── MIGRACIÓN SQL para roe_submissions ───
 *
 * CREATE TABLE IF NOT EXISTS roe_submissions (
 *   id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   employee_id                     UUID NOT NULL REFERENCES employees(id),
 *   serial_number                   TEXT NOT NULL UNIQUE,
 *   termination_code                CHAR(1) NOT NULL,
 *   termination_date                DATE NOT NULL,
 *   total_insurable_earnings_cents  INTEGER NOT NULL,
 *   total_insurable_hours           NUMERIC(8,1) NOT NULL,
 *   xml_content                     TEXT NOT NULL,
 *   content_hash                    TEXT NOT NULL,
 *   validation_valid                BOOLEAN NOT NULL DEFAULT false,
 *   validation_errors               TEXT[] DEFAULT '{}',
 *   validation_warnings             TEXT[] DEFAULT '{}',
 *   generated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   submitted_to_service_canada_at  TIMESTAMPTZ,
 *   created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
 *
 *   CONSTRAINT chk_termination_code CHECK (termination_code ~ '^[A-Z]$')
 * );
 *
 * CREATE INDEX idx_roe_submissions_employee ON roe_submissions (employee_id);
 * CREATE INDEX idx_roe_submissions_serial ON roe_submissions (serial_number);
 * CREATE INDEX idx_roe_submissions_termination_date ON roe_submissions (termination_date);
 */

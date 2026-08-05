/**
 * v8.5 Capa 6 del Financial Core — T4 Submission Orchestrator.
 *
 * Orquesta la generación, validación y registro de envíos T4 ante CRA.
 * Conecta t4-generator.ts (funciones puras de generación) con Supabase
 * (datos de empleados, payroll_linea, y admin_action_logs para historial).
 *
 * Interconexiones:
 *   t4-submission.ts ──(usa)──→ t4-generator.ts (slips, summary, XML, PDF)
 *   t4-submission.ts ──(usa)──→ payroll-line.ts (PayrollLineaRow)
 *   t4-submission.ts ──(usado por)──→ src/app/api/admin/tax/t4/route.ts
 */

import { type SupabaseClient } from "@supabase/supabase-js";

import type { PayrollLineaRow } from "./payroll-line";
import {
  generateT4Slip,
  generateT4Summary,
  generateT4SubmissionXml,
  generateT4SummaryPdf,
  validateT4SubmissionXml,
  aggregateYearlyLines,
  getT4FilingDeadline,
  getT4IssuanceDeadline,
  T4_EMPLOYER,
  type T4Slip,
  type T4Summary,
  type T4EmployeeInfo,
  type T4TransmitterContact,
  type T4XmlValidationResult,
} from "./t4-generator";

// =========================================================================
// Types
// =========================================================================

/**
 * Resultado completo de una generación de T4 submission.
 *
 * Contiene el XML para CRA, el HTML del summary para revisión,
 * los slips individuales, el summary agregado, y el resultado
 * de la validación.
 */
export interface T4SubmissionResult {
  /** Año fiscal del T4. */
  anio: number;
  /** XML completo T619 listo para transmisión a CRA. */
  xml: string;
  /** HTML del T4 Summary para revisión/impresión. */
  summaryHtml: string;
  /** Slips individuales generados. */
  slips: T4Slip[];
  /** Summary agregado. */
  summary: T4Summary;
  /** Resultado de la validación estructural y XSD-aware. */
  validation: T4XmlValidationResult;
  /** Fecha límite de filing ante CRA. */
  filingDeadline: string;
  /** Fecha límite de emisión a empleados. */
  issuanceDeadline: string;
  /** Timestamp ISO 8601 de generación. */
  generatedAt: string;
}

/**
 * Registro de un envío T4 en admin_action_logs.
 */
export interface T4SubmissionRecord {
  /** ID del registro en admin_action_logs. */
  id: string;
  /** Año fiscal del envío. */
  anio: number;
  /** ID del admin que generó el envío. */
  userId: string;
  /** Timestamp ISO 8601 del envío. */
  createdAt: string;
  /** Número de slips incluidos. */
  totalSlips: number;
  /** Total de employment income reportado (centavos). */
  totalIncomeCents: number;
}

// =========================================================================
// prepareT4Submission()
// =========================================================================

/**
 * Orquesta la generación completa de un T4 submission para un año fiscal.
 *
 * Flujo:
 *   1. Consulta todas las líneas de payroll_linea del año.
 *   2. Consulta la info de empleados (nombre, dirección).
 *   3. Agrega por empleado con aggregateYearlyLines().
 *   4. Genera T4Slip para cada empleado con generateT4Slip().
 *   5. Genera T4Summary con generateT4Summary().
 *   6. Genera XML T619 con generateT4SubmissionXml().
 *   7. Genera HTML del summary con generateT4SummaryPdf().
 *   8. Valida el XML con validateT4SubmissionXml().
 *
 * @param supabase — Cliente Supabase (service role para acceder a payroll_linea y employees).
 * @param anio — Año fiscal del T4 (ej. 2026).
 * @param contact — Información de contacto del transmisor para el T619.
 * @returns T4SubmissionResult con XML, HTML, slips, summary y validación.
 */
export async function prepareT4Submission(
  supabase: SupabaseClient,
  anio: number,
  contact?: T4TransmitterContact,
): Promise<T4SubmissionResult> {
  const anioStr = String(anio);

  // ── 1. Fetch payroll lines for the fiscal year ─────────────────────────
  const { data: lineas, error: lineasError } = await supabase
    .from("payroll_linea")
    .select("*")
    .gte("creado_en", anioStr + "-01-01")
    .lte("creado_en", anioStr + "-12-31")
    .order("creado_en", { ascending: true });

  if (lineasError) {
    throw new Error(
      "Error al consultar payroll_linea para T4 " + anioStr + ": " + lineasError.message,
    );
  }

  const allLineas = (lineas ?? []) as PayrollLineaRow[];

  // ── 2. Get unique employee IDs ─────────────────────────────────────────
  const employeeIds = [...new Set(allLineas.map((l) => l.employee_id))];

  if (employeeIds.length === 0) {
    // No hay líneas de nómina para este año — submission vacío
    const emptySlips: T4Slip[] = [];
    const emptySummary: T4Summary = {
      taxYear: anio,
      employer: T4_EMPLOYER,
      totalSlips: 0,
      totals: {
        employmentIncomeCents: 0,
        cppEmployeeCents: 0,
        cppPensionableEarningsCents: 0,
        eiEmployeeCents: 0,
        eiInsurableEarningsCents: 0,
        incomeTaxDeductedCents: 0,
        unionDuesCents: 0,
        charitableDonationsCents: 0,
        rppContributionsCents: 0,
        pensionAdjustmentCents: 0,
      },
      generatedAt: new Date().toISOString(),
    };
    const xml = generateT4SubmissionXml(anio);
    const summaryHtml = generateT4SummaryPdf(emptySlips, emptySummary, contact);
    const validation = validateT4Xml(xml);

    return {
      anio,
      xml,
      summaryHtml,
      slips: emptySlips,
      summary: emptySummary,
      validation,
      filingDeadline: getT4FilingDeadline(anio),
      issuanceDeadline: getT4IssuanceDeadline(anio),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 3. Fetch employee info ─────────────────────────────────────────────
  const { data: employees, error: empError } = await supabase
    .from("employees")
    .select("id, first_name, last_name, address_line1, address_line2, city, province, postal_code, sin_encrypted")
    .in("id", employeeIds);

  if (empError) {
    throw new Error(
      "Error al consultar employees para T4 " + anioStr + ": " + empError.message,
    );
  }

  // Build employee lookup map
  const employeeMap = new Map<string, (typeof employees)[number]>();
  for (const emp of employees ?? []) {
    employeeMap.set(emp.id, emp);
  }

  // ── 4. Aggregate per employee, generate slips ──────────────────────────
  const slips: T4Slip[] = [];

  for (const empId of employeeIds) {
    const empData = employeeMap.get(empId);
    if (!empData) continue;

    const empLineas = allLineas.filter((l) => l.employee_id === empId);
    if (empLineas.length === 0) continue;

    // Aggregate yearly data for this employee
    const aggregate = aggregateYearlyLines(empLineas);

    // Build employee info for T4
    // SIN: usamos sin_encrypted como placeholder — el descifrado real
    // requiere get_employee_banking_info() con rol owner_admin.
    // Para el XML de T4, el SIN se enmascara con maskSin() dentro de
    // generateT4Slip(). El valor real se obtiene del campo sin_encrypted
    // (que el caller debe descifrar antes si necesita el SIN real).
    const employeeInfo: T4EmployeeInfo = {
      employeeId: empId,
      legalName: (empData.first_name ?? "") + " " + (empData.last_name ?? ""),
      address: {
        line1: empData.address_line1 ?? "",
        line2: empData.address_line2 ?? undefined,
        city: empData.city ?? "",
        province: empData.province ?? "BC",
        postalCode: empData.postal_code ?? "",
      },
      sin: empData.sin_encrypted ?? "000000000",
      provinceOfEmployment: empData.province ?? "BC",
    };

    const slip = generateT4Slip(employeeInfo, aggregate, anio);
    slips.push(slip);
  }

  // ── 5. Generate summary ────────────────────────────────────────────────
  const summary = generateT4Summary(slips, anio);

  // ── 6. Generate XML ────────────────────────────────────────────────────
  const xml = generateT4SubmissionXml(anio);

  // ── 7. Generate summary HTML ───────────────────────────────────────────
  const summaryHtml = generateT4SummaryPdf(slips, summary, contact);

  // ── 8. Validate ────────────────────────────────────────────────────────
  const validation = validateT4Xml(xml);

  return {
    anio,
    xml,
    summaryHtml,
    slips,
    summary,
    validation,
    filingDeadline: getT4FilingDeadline(anio),
    issuanceDeadline: getT4IssuanceDeadline(anio),
    generatedAt: new Date().toISOString(),
  };
}

// =========================================================================
// validateT4Xml()
// =========================================================================

/**
 * Valida un XML T4 contra las reglas de negocio y schema de CRA.
 *
 * Delega en validateT4SubmissionXml() de t4-generator.ts, que realiza
 * validación estructural (boxes obligatorios, totales, formato SIN)
 * y validación schema-aware (namespace T619, atributos requeridos,
 * coherencia Transmitter/Summary).
 *
 * Para validación XSD completa con parser externo:
 *   xmllint --schema T619_26.xsd --noout t4-submission.xml
 *
 * @param xml — string XML a validar.
 * @returns T4XmlValidationResult con errores y advertencias.
 */
export function validateT4Xml(xml: string): T4XmlValidationResult {
  return validateT4Xml(xml);
}

// =========================================================================
// getSubmissionHistory()
// =========================================================================

/**
 * Recupera el historial de envíos T4 registrados en admin_action_logs.
 *
 * Consulta los logs de acciones administrativas filtrando por recurso
 * "finance" y método "T4_SUBMIT". Retorna los envíos ordenados por fecha
 * descendente (más reciente primero).
 *
 * @param supabase — Cliente Supabase (service role recomendado).
 * @param limit — Número máximo de registros a retornar (default: 10).
 * @returns Array de T4SubmissionRecord.
 */
export async function getSubmissionHistory(
  supabase: SupabaseClient,
  limit = 10,
): Promise<T4SubmissionRecord[]> {
  const { data, error } = await supabase
    .from("admin_action_logs")
    .select("id, user_id, created_at, path")
    .eq("resource", "finance")
    .eq("method", "T4_SUBMIT")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("t4-submission: error al consultar historial:", error);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    // Metadata is encoded in the path field as a query-string-like suffix
    // Format: /api/admin/tax/t4?anio=2026&slips=3&income=15000000
    const path = String(row.path ?? "");
    const params = new URLSearchParams(path.includes("?") ? path.split("?")[1] : "");
    return {
      id: String(row.id ?? ""),
      anio: Number(params.get("anio") ?? 0),
      userId: String(row.user_id ?? ""),
      createdAt: String(row.created_at ?? ""),
      totalSlips: Number(params.get("slips") ?? 0),
      totalIncomeCents: Number(params.get("income") ?? 0),
    };
  });
}

// =========================================================================
// recordT4Submission()
// =========================================================================

/**
 * Registra un envío T4 en admin_action_logs para auditoría.
 *
 * Escribe un registro inmutable con método "T4_SUBMIT" y metadata
 * que incluye el año fiscal, número de slips, total de income y
 * resultado de la validación.
 *
 * @param supabase — Cliente Supabase (service role recomendado).
 * @param userId — UUID del admin que generó el envío.
 * @param result — T4SubmissionResult del envío generado.
 * @returns true si se registró correctamente, false si hubo error.
 */
export async function recordT4Submission(
  supabase: SupabaseClient,
  userId: string,
  result: T4SubmissionResult,
): Promise<boolean> {
  // Encode submission metadata in the path field (admin_action_logs
  // no tiene columna metadata — usamos query params en path para
  // preservar los datos de auditoría).
  const metadataPath =
    "/api/admin/tax/t4" +
    "?anio=" + result.anio +
    "&slips=" + result.summary.totalSlips +
    "&income=" + result.summary.totals.employmentIncomeCents +
    "&tax=" + result.summary.totals.incomeTaxDeductedCents +
    "&valid=" + (result.validation.valid ? "1" : "0") +
    "&errors=" + result.validation.errors.length;

  const { error } = await supabase.from("admin_action_logs").insert({
    user_id: userId,
    role_used: "owner_admin",
    method: "T4_SUBMIT",
    path: metadataPath,
    resource: "finance",
  });

  if (error) {
    console.error("t4-submission: error al registrar envío:", error);
    return false;
  }

  return true;
}

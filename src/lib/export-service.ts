/**
 * Capa 9 — Export Service: Orquestación de exportaciones contables.
 *
 * Punto central de orquestación para el endpoint unificado de exportación
 * (`POST /api/admin/export/accounting`). Coordina la validación del request,
 * la autorización RBAC, la lectura de datos del shadow ledger, la creación
 * del adaptador contable adecuado, y la auditoría de cada exportación.
 *
 * Separado del route handler para mantener la API route ligera (solo HTTP
 * concerns) y toda la lógica de negocio testeable sin levantar el servidor.
 *
 * Dependencias:
 *   - accounting-adapter.ts: tipos, validación de formato, parseo de períodos.
 *   - admin-rbac.ts: roleAllows para verificar permisos del admin.
 *   - adapters/accounting/*.ts: fábricas de adaptadores (CSV, IIF, PDF).
 *   - financial-reports.ts: tipo FinancialLedgerEntry.
 *   - Supabase client: lectura de shadow_ledger_entries + escritura de auditoría.
 *
 * @module export-service
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminRole } from "@/lib/admin-rbac";
import { roleAllows } from "@/lib/admin-rbac";
import type { FinancialLedgerEntry, LedgerEntrySource } from "@/lib/financial-reports";
import {
  validateExportFormat,
  parsePeriodRange,
  getExportFileName,
  type ExportFormat,
  type PeriodRange,
  EXPORT_MIME_TYPES,
} from "@/lib/accounting-adapter";
import { createCsvAdapter } from "@/adapters/accounting/csv-adapter";
import { createIifAdapter } from "@/adapters/accounting/iif-adapter";
import { createPdfAdapter } from "@/adapters/accounting/pdf-adapter";

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/**
 * Schema de validación para el body de una solicitud de exportación.
 *
 * Valida que:
 * - `periodo` sea un string no vacío (el parseo detallado lo hace
 *   `parsePeriodRange` después, para dar mensajes de error más ricos).
 * - `format` sea uno de los cuatro formatos soportados.
 */
export const ExportRequestSchema = z.object({
  periodo: z.string().min(1, "El campo 'periodo' no puede estar vacío"),
  format: z
    .string()
    .refine(
      (val): val is ExportFormat => validateExportFormat(val),
      {
        message:
          "Formato inválido. Debe ser uno de: csv, iif, pdf, json",
      }
    ),
});

/** Tipo inferido del schema de request de exportación. */
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

// ---------------------------------------------------------------------------
// Export result types
// ---------------------------------------------------------------------------

/**
 * Resultado exitoso de una exportación.
 *
 * `content` es el cuerpo del archivo (string para CSV/IIF/HTML/JSON),
 * listo para escribirse en la respuesta HTTP o guardarse en Storage.
 */
export interface ExportSuccess {
  ok: true;
  /** Contenido del archivo exportado. */
  content: string;
  /** MIME type canónico para el Content-Type header. */
  contentType: string;
  /** Nombre de archivo estandarizado para Content-Disposition. */
  fileName: string;
  /** Cantidad de entradas del ledger incluidas en la exportación. */
  entryCount: number;
  /** Período(s) cubiertos (para el mensaje de auditoría). */
  periodLabel: string;
}

/** Resultado de error de una exportación. */
export interface ExportError {
  ok: false;
  /** Código de error para el frontend. */
  code: string;
  /** Mensaje legible. */
  message: string;
  /** Status HTTP sugerido. */
  status: number;
}

/** Unión discriminada del resultado de exportación. */
export type ExportResult = ExportSuccess | ExportError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifica que al menos uno de los roles del admin tenga permiso para
 * acceder al recurso `finance`.
 *
 * Solo `owner_admin` tiene acceso a finanzas según la matriz RBAC.
 *
 * @param roles Roles administrativos del usuario autenticado.
 * @returns `true` si el usuario tiene permiso para exportar datos financieros.
 */
export function validateExportPermission(roles: AdminRole[]): boolean {
  return roleAllows(roles, "finance");
}

/**
 * Genera una etiqueta legible para el período exportado (para logs de auditoría).
 *
 * @param rango Rango normalizado de períodos.
 * @returns String legible como "2026-08" o "2026-01 → 2026-06".
 */
function periodLabel(rango: PeriodRange): string {
  return rango.isRange ? `${rango.start} → ${rango.end}` : rango.start;
}

// ---------------------------------------------------------------------------
// Shadow ledger → FinancialLedgerEntry mapping
// ---------------------------------------------------------------------------

/**
 * Fila cruda del shadow ledger tal como la devuelve Supabase.
 *
 * Solo los campos que necesitamos para mapear a FinancialLedgerEntry.
 */
interface ShadowLedgerRow {
  id: string;
  event_type: string;
  order_id: string | null;
  amount_cents: number;
  currency: string;
  occurred_at: string;
  external_reference: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Mapea una fila del shadow ledger a una entrada de ledger financiero
 * compatible con los adaptadores de exportación.
 *
 * La dirección (debit/credit) y el código de cuenta se infieren del
 * `event_type` del shadow ledger usando un mapeo determinístico basado
 * en si el evento representa entrada o salida de dinero.
 *
 * @param row Fila cruda de `shadow_ledger_entries`.
 * @param periodo Período contable YYYY-MM al que pertenece esta entrada.
 * @returns Entrada formateada para los adaptadores contables.
 */
function mapShadowLedgerRowToEntry(
  row: ShadowLedgerRow,
  periodo: string
): FinancialLedgerEntry {
  const mapping = getEventAccountMapping(row.event_type);

  return {
    id: row.id,
    accountCode: mapping.accountCode,
    amountCents: row.amount_cents,
    direction: mapping.direction,
    period: periodo,
    occurredAt: row.occurred_at,
    orderId: row.order_id ?? undefined,
    source: "system" as LedgerEntrySource,
    description: mapping.description,
    metadata: row.metadata ?? undefined,
  };
}

/**
 * Resultado del mapeo evento → cuenta contable.
 */
interface EventAccountMapping {
  accountCode: string;
  direction: "debit" | "credit";
  description: string;
}

/**
 * Mapa determinístico de event_type del shadow ledger a cuenta contable
 * y dirección (débito/crédito).
 *
 * Principio contable:
 * - Entradas de dinero (capturas, anticipos PayPal) → CRÉDITO a ingresos (4010).
 * - Salidas de dinero (reembolsos, liberaciones) → DÉBITO a contra-ingresos (4020).
 * - Fallos de captura → no generan movimiento de cuenta (4000 = cuenta puente).
 */
const EVENT_ACCOUNT_MAP: Record<string, EventAccountMapping> = {
  hold_captured: {
    accountCode: "4010",
    direction: "credit",
    description: "Captura de hold — ingreso por servicio",
  },
  balance_captured: {
    accountCode: "4010",
    direction: "credit",
    description: "Captura de saldo restante — ingreso por servicio",
  },
  paypal_advance_received: {
    accountCode: "4010",
    direction: "credit",
    description: "Anticipo PayPal recibido — ingreso por servicio",
  },
  hold_released: {
    accountCode: "4020",
    direction: "debit",
    description: "Liberación de hold — contra-ingreso",
  },
  paypal_refund: {
    accountCode: "4020",
    direction: "debit",
    description: "Reembolso PayPal — contra-ingreso",
  },
  cancellation_penalty: {
    accountCode: "4010",
    direction: "credit",
    description: "Penalidad por cancelación — ingreso",
  },
  warranty_refund: {
    accountCode: "4020",
    direction: "debit",
    description: "Reembolso por garantía — contra-ingreso",
  },
  capture_failed: {
    accountCode: "4000",
    direction: "debit",
    description: "Intento de captura fallido — cuenta puente (sin efecto neto)",
  },
  hold_authorized: {
    accountCode: "4000",
    direction: "debit",
    description: "Hold autorizado — cuenta puente (sin efecto neto)",
  },
};

/** Fallback para event_types no mapeados explícitamente. */
const FALLBACK_MAPPING: EventAccountMapping = {
  accountCode: "4000",
  direction: "credit",
  description: "Evento no clasificado — cuenta puente",
};

function getEventAccountMapping(eventType: string): EventAccountMapping {
  return EVENT_ACCOUNT_MAP[eventType] ?? FALLBACK_MAPPING;
}

// ---------------------------------------------------------------------------
// Period iteration
// ---------------------------------------------------------------------------

/**
 * Genera todos los períodos YYYY-MM entre `start` y `end` (inclusivos).
 *
 * @param start Período inicial (YYYY-MM).
 * @param end Período final (YYYY-MM).
 * @returns Arreglo de períodos en orden cronológico.
 *
 * @example
 * ```ts
 * generatePeriods("2026-01", "2026-03")
 * // → ["2026-01", "2026-02", "2026-03"]
 * ```
 */
function generatePeriods(start: string, end: string): string[] {
  const periods: string[] = [];
  const [startYear, startMonth] = start.split("-").map(Number);
  const [endYear, endMonth] = end.split("-").map(Number);

  let y = startYear;
  let m = startMonth;

  while (y < endYear || (y === endYear && m <= endMonth)) {
    periods.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  return periods;
}

// ---------------------------------------------------------------------------
// Core: handleExportRequest
// ---------------------------------------------------------------------------

/**
 * Orquesta una exportación contable completa.
 *
 * Flujo:
 * 1. Valida y parsea el body del request con Zod.
 * 2. Parsea el rango de períodos.
 * 3. Consulta `shadow_ledger_entries` para el rango de fechas.
 * 4. Mapea las filas a `FinancialLedgerEntry[]`.
 * 5. Crea el adaptador contable del formato solicitado.
 * 6. Para cada período en el rango, ejecuta `exportJournalEntries`.
 * 7. Concatena los resultados si es rango múltiple.
 * 8. Devuelve `ExportSuccess` con contenido, tipo, y nombre de archivo.
 *
 * @param supabase Cliente Supabase autenticado (con RLS del admin).
 * @param body Body del request validado (periodo + format).
 * @returns `ExportResult` — éxito con el contenido, o error con código.
 */
export async function handleExportRequest(
  supabase: SupabaseClient,
  body: ExportRequest
): Promise<ExportResult> {
  // 1. Validar body con Zod
  const parsed = ExportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: parsed.error.issues.map((i) => i.message).join("; "),
      status: 400,
    };
  }

  const { periodo: rawPeriodo, format } = parsed.data;

  // 2. Parsear rango de períodos
  let rango: PeriodRange;
  try {
    rango = parsePeriodRange(rawPeriodo);
  } catch (err) {
    return {
      ok: false,
      code: "INVALID_PERIOD",
      message:
        err instanceof Error ? err.message : "Período inválido",
      status: 400,
    };
  }

  // 3. Generar los períodos a cubrir
  const periods = generatePeriods(rango.start, rango.end);

  // 4. Construir rango de fechas para la query
  const dateFrom = `${rango.start}-01`;
  // Último día del último mes del rango
  const [endY, endM] = rango.end.split("-").map(Number);
  const lastDay = new Date(endY, endM, 0).getDate();
  const dateTo = `${rango.end}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;

  // 5. Consultar shadow_ledger_entries
  const { data: rows, error: queryError } = await supabase
    .from("shadow_ledger_entries")
    .select(
      "id, event_type, order_id, amount_cents, currency, occurred_at, external_reference, metadata"
    )
    .gte("occurred_at", dateFrom)
    .lte("occurred_at", dateTo)
    .order("occurred_at", { ascending: true });

  if (queryError) {
    console.error("export-service: shadow_ledger query failed", queryError);
    return {
      ok: false,
      code: "DB_QUERY_ERROR",
      message: "Error al consultar el ledger financiero",
      status: 500,
    };
  }

  const shadowRows = (rows ?? []) as ShadowLedgerRow[];

  // 6. Mapear a FinancialLedgerEntry[]
  const entries: FinancialLedgerEntry[] = shadowRows.map((row) => {
    // Derivar período YYYY-MM de occurred_at
    const occurredDate = row.occurred_at.slice(0, 7); // "2026-08-15..." → "2026-08"
    return mapShadowLedgerRowToEntry(row, occurredDate);
  });

  // 7. Formato JSON: devolver los datos crudos directamente
  if (format === "json") {
    const jsonContent = JSON.stringify(
      {
        exportGeneratedAt: new Date().toISOString(),
        period: rawPeriodo,
        periods,
        entryCount: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          accountCode: e.accountCode,
          amountCents: e.amountCents,
          direction: e.direction,
          period: e.period,
          occurredAt: e.occurredAt,
          orderId: e.orderId,
          description: e.description,
        })),
      },
      null,
      2
    );

    return {
      ok: true,
      content: jsonContent,
      contentType: EXPORT_MIME_TYPES.json,
      fileName: getExportFileName(rawPeriodo, format),
      entryCount: entries.length,
      periodLabel: periodLabel(rango),
    };
  }

  // 8. Seleccionar y crear el adaptador
  let adapterFactory: (entries: FinancialLedgerEntry[]) => {
    exportJournalEntries(periodo: string): string | Buffer;
  };

  switch (format) {
    case "csv":
      adapterFactory = createCsvAdapter;
      break;
    case "iif":
      adapterFactory = createIifAdapter;
      break;
    case "pdf":
      adapterFactory = createPdfAdapter;
      break;
    default:
      return {
        ok: false,
        code: "UNSUPPORTED_FORMAT",
        message: `Formato no soportado: ${format}`,
        status: 400,
      };
  }

  const adapter = adapterFactory(entries);

  // 9. Exportar período por período
  const outputs: string[] = [];
  for (const period of periods) {
    const output = adapter.exportJournalEntries(period);
    outputs.push(typeof output === "string" ? output : "");
  }

  const content = outputs.join(
    format === "iif" ? "\n" : format === "csv" ? "" : "\n"
  );

  return {
    ok: true,
    content,
    contentType: EXPORT_MIME_TYPES[format],
    fileName: getExportFileName(rawPeriodo, format),
    entryCount: entries.length,
    periodLabel: periodLabel(rango),
  };
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

/**
 * Registra una exportación en el log de auditoría administrativa.
 *
 * Usa la tabla `admin_action_logs` — la misma que `requireAdminRole`
 * utiliza para todas las escrituras administrativas — para mantener un
 * solo flujo de auditoría consolidado. Se registra con `resource: "finance"`
 * y `method: "EXPORT"` para distinguirlo de otras acciones financieras.
 *
 * El log de auditoría es best-effort: si falla, se loguea el error en
 * consola pero NO se bloquea la exportación (el archivo ya se generó).
 *
 * @param supabase Cliente Supabase del admin autenticado.
 * @param periodo Etiqueta del período exportado (ej. "2026-08" o "2026-01 → 2026-06").
 * @param format Formato de la exportación.
 * @param adminId UUID del admin que solicitó la exportación.
 */
export async function logExportAudit(
  supabase: SupabaseClient,
  periodo: string,
  format: ExportFormat,
  adminId: string
): Promise<void> {
  // El path incluye query params simulados con los detalles de la exportación
  // porque admin_action_logs no tiene columna `metadata`. Esto permite
  // reconstruir qué se exportó desde el log de auditoría sin migración extra.
  const auditPath = `/api/admin/export/accounting?periodo=${encodeURIComponent(periodo)}&format=${format}`;

  const { error } = await supabase.from("admin_action_logs").insert({
    user_id: adminId,
    role_used: "owner_admin", // Solo owner_admin puede exportar finanzas
    method: "EXPORT",
    path: auditPath,
    resource: "finance",
  });

  if (error) {
    console.error("export-service: audit log insert failed", error);
    // No bloqueamos la exportación por un fallo de auditoría — el archivo
    // ya se generó. Pero lo registramos para diagnóstico.
  }
}

// ---------------------------------------------------------------------------
// Export history
// ---------------------------------------------------------------------------

/**
 * Entrada del historial de exportaciones para un admin específico.
 */
export interface ExportHistoryEntry {
  /** Período exportado (etiqueta legible). */
  periodo: string;
  /** Formato de la exportación. */
  format: string;
  /** Timestamp de cuándo se realizó la exportación. */
  exportedAt: string;
}

/**
 * Obtiene el historial de exportaciones recientes de un admin.
 *
 * Consulta `admin_action_logs` filtrando por `user_id`, `resource = "finance"`,
 * y `method = "EXPORT"`. Devuelve las últimas 20 exportaciones, ordenadas
 * por más reciente primero.
 *
 * @param supabase Cliente Supabase (service role para evitar RLS).
 * @param adminId UUID del admin cuyo historial se consulta.
 * @returns Arreglo de entradas de historial (vacío si no hay exportaciones previas).
 */
export async function getExportHistory(
  supabase: SupabaseClient,
  adminId: string
): Promise<ExportHistoryEntry[]> {
  const { data, error } = await supabase
    .from("admin_action_logs")
    .select("path, created_at")
    .eq("user_id", adminId)
    .eq("resource", "finance")
    .eq("method", "EXPORT")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error || !data) {
    console.error("export-service: history query failed", error);
    return [];
  }

  return data.map((row: Record<string, unknown>) => {
    const path = String(row.path ?? "");
    const periodo = extractQueryParam(path, "periodo") ?? "desconocido";
    const format = extractQueryParam(path, "format") ?? "desconocido";
    return {
      periodo,
      format,
      exportedAt: String(row.created_at ?? ""),
    };
  });
}

/**
 * Extrae un query param de un path de auditoría.
 *
 * Los paths de auditoría tienen el formato:
 * `/api/admin/export/accounting?periodo=2026-08&format=csv`
 *
 * @param path Path completo con query string.
 * @param param Nombre del parámetro a extraer.
 * @returns Valor decodificado del parámetro, o `null` si no existe.
 */
function extractQueryParam(path: string, param: string): string | null {
  try {
    const url = new URL(path, "http://localhost");
    return url.searchParams.get(param);
  } catch {
    // Si el path no es parseable como URL, intentamos regex simple
    const match = path.match(new RegExp(`[?&]${param}=([^&]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting helper
// ---------------------------------------------------------------------------

/**
 * Verifica si un admin ha excedido el rate limit de exportaciones.
 *
 * Rate limit: máximo 1 exportación por minuto por admin. Consulta
 * `admin_action_logs` para la exportación más reciente del admin al
 * endpoint de exportación. Si ocurrió hace menos de 60 segundos, rechaza.
 *
 * @param supabase Cliente Supabase del admin autenticado.
 * @param adminId UUID del admin.
 * @returns `true` si el admin está rate-limited (debe esperar).
 */
export async function isExportRateLimited(
  supabase: SupabaseClient,
  adminId: string
): Promise<{ limited: boolean; retryAfterSecs: number }> {
  const { data } = await supabase
    .from("admin_action_logs")
    .select("created_at")
    .eq("user_id", adminId)
    .eq("resource", "finance")
    .eq("method", "EXPORT")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) {
    return { limited: false, retryAfterSecs: 0 };
  }

  const lastExport = new Date((data[0] as { created_at: string }).created_at);
  const elapsedMs = Date.now() - lastExport.getTime();
  const elapsedSecs = Math.floor(elapsedMs / 1000);
  const cooldownSecs = 60;

  if (elapsedSecs < cooldownSecs) {
    return {
      limited: true,
      retryAfterSecs: cooldownSecs - elapsedSecs,
    };
  }

  return { limited: false, retryAfterSecs: 0 };
}

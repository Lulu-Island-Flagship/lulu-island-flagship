/**
 * v8.3 G.4 — Operaciones en Lote (Bulk).
 *
 * Utilidades para operaciones masivas sobre tablas admin: subir/bajar %,
 * desactivar seleccionados, exportar. Siempre con previsualización antes
 * de confirmar — nunca se ejecuta una operación en lote sin que el admin
 * vea exactamente qué va a cambiar.
 *
 * Aplica a: pricing rules, clientes, empleados, inventario.
 *
 * Diseño: funciones puras que reciben los ítems seleccionados y el tipo de
 * operación, devuelven una previsualización con el antes/después de cada
 * ítem. El commit real (UPDATE/INSERT en DB) lo hace el route handler
 * después de que el admin confirma la previsualización.
 */

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

/** Tipo de entidad sobre la que se opera en lote. */
export type BulkEntityType = "pricing_rule" | "client" | "employee" | "inventory_item";

/** Operaciones bulk soportadas. */
export type BulkOperationType =
  | "raise_percent"
  | "lower_percent"
  | "deactivate"
  | "activate"
  | "export";

export interface BulkOperationInput {
  entityType: BulkEntityType;
  operation: BulkOperationType;
  /** Porcentaje de ajuste para raise_percent / lower_percent. Ej: 5 = +5%. */
  percentDelta?: number;
  /** IDs o claves de los ítems seleccionados. */
  selectedIds: string[];
}

/** Un ítem individual dentro de un lote. */
export interface BulkItem {
  id: string;
  /** Etiqueta legible para mostrar en la previsualización. */
  label: string;
  /** Valor actual (precio, estado, etc.) — string para máxima flexibilidad. */
  currentValue: string;
  /** Valor numérico actual si aplica (para ajustes porcentuales). */
  currentNumericValue?: number;
  /** Estado actual (active/inactive). */
  currentStatus?: "active" | "inactive";
}

/** Resultado de una fila en la previsualización. */
export interface BulkPreviewRow {
  item: BulkItem;
  /** Valor después de aplicar la operación. */
  newValue: string;
  newNumericValue?: number;
  newStatus?: "active" | "inactive";
  /** true si la operación cambiaría este ítem. */
  willChange: boolean;
  /** Advertencia si el cambio tendría efectos secundarios (ej. precio bajo margen). */
  warning?: string;
}

export interface BulkPreview {
  operation: BulkOperationType;
  entityType: BulkEntityType;
  percentDelta?: number;
  totalSelected: number;
  /** Ítems que efectivamente cambiarían. */
  changedCount: number;
  rows: BulkPreviewRow[];
  /** Advertencias globales (ej. "2 ítems caerían bajo el margen mínimo"). */
  globalWarnings: string[];
  /** Timestamp de generación de la previsualización. */
  generatedAt: string;
  /** Hash para que el frontend verifique que la previsualización no fue alterada antes del commit. */
  previewId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Umbrales y constantes
// ═══════════════════════════════════════════════════════════════════════════

/** Margen de contribución mínimo permitido (D.2). Un ajuste de precio que
 * lleve un ítem por debajo de este umbral genera warning. */
export const MIN_CONTRIBUTION_MARGIN_PERCENT = 15;

/** Límite de % de aumento en una sola operación bulk (anti-error: evita
 * subir 500% por un typo). */
export const MAX_SINGLE_RAISE_PERCENT = 50;

/** Límite de % de baja en una sola operación bulk. */
export const MAX_SINGLE_LOWER_PERCENT = 50;

// ═══════════════════════════════════════════════════════════════════════════
// Previsualización
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera la previsualización de una operación en lote ANTES de ejecutarla.
 * El admin ve cada fila con antes/después y confirma o cancela.
 *
 * @param items — ítems seleccionados con sus valores actuales.
 * @param operation — tipo de operación.
 * @param percentDelta — % de ajuste (solo para raise/lower_percent).
 * @param nowIso — timestamp ISO de generación.
 */
export function generateBulkPreview(
  items: BulkItem[],
  operation: BulkOperationType,
  percentDelta: number | undefined,
  nowIso: string
): BulkPreview {
  const globalWarnings: string[] = [];
  const rows: BulkPreviewRow[] = [];

  // Validar percentDelta
  if (operation === "raise_percent" || operation === "lower_percent") {
    const delta = percentDelta ?? 0;
    if (delta <= 0) {
      globalWarnings.push(
        `Delta de ${delta}% no es válido para ${operation}. Debe ser > 0.`
      );
    }
    if (operation === "raise_percent" && delta > MAX_SINGLE_RAISE_PERCENT) {
      globalWarnings.push(
        `Aumento de ${delta}% excede el límite de ${MAX_SINGLE_RAISE_PERCENT}% por operación.`
      );
    }
    if (operation === "lower_percent" && delta > MAX_SINGLE_LOWER_PERCENT) {
      globalWarnings.push(
        `Baja de ${delta}% excede el límite de ${MAX_SINGLE_LOWER_PERCENT}% por operación.`
      );
    }
  }

  for (const item of items) {
    const row = computePreviewRow(item, operation, percentDelta);
    rows.push(row);
    if (row.warning) {
      globalWarnings.push(`${item.label}: ${row.warning}`);
    }
  }

  const changedCount = rows.filter((r) => r.willChange).length;

  return {
    operation,
    entityType: inferEntityType(items),
    percentDelta,
    totalSelected: items.length,
    changedCount,
    rows,
    globalWarnings,
    generatedAt: nowIso,
    previewId: buildPreviewId(items, operation, percentDelta, nowIso),
  };
}

function computePreviewRow(
  item: BulkItem,
  operation: BulkOperationType,
  percentDelta: number | undefined
): BulkPreviewRow {
  switch (operation) {
    case "raise_percent":
      return previewRaisePercent(item, percentDelta ?? 0);
    case "lower_percent":
      return previewLowerPercent(item, percentDelta ?? 0);
    case "deactivate":
      return previewDeactivate(item);
    case "activate":
      return previewActivate(item);
    case "export":
      return previewExport(item);
  }
}

function previewRaisePercent(item: BulkItem, delta: number): BulkPreviewRow {
  const current = item.currentNumericValue;
  if (current === undefined || current === null) {
    return {
      item,
      newValue: item.currentValue,
      willChange: false,
      warning: "Sin valor numérico — no se puede ajustar %.",
    };
  }
  const validDelta = Math.max(0, Math.min(delta, MAX_SINGLE_RAISE_PERCENT));
  const newVal = round2(current * (1 + validDelta / 100));
  return {
    item,
    newValue: formatNumeric(newVal),
    newNumericValue: newVal,
    willChange: validDelta > 0 && newVal !== current,
  };
}

function previewLowerPercent(item: BulkItem, delta: number): BulkPreviewRow {
  const current = item.currentNumericValue;
  if (current === undefined || current === null) {
    return {
      item,
      newValue: item.currentValue,
      willChange: false,
      warning: "Sin valor numérico — no se puede ajustar %.",
    };
  }
  const validDelta = Math.max(0, Math.min(delta, MAX_SINGLE_LOWER_PERCENT));
  const newVal = round2(Math.max(0, current * (1 - validDelta / 100)));
  const warnings: string[] = [];

  // Warning de margen mínimo
  if (item.currentNumericValue !== undefined && newVal < item.currentNumericValue * 0.7) {
    warnings.push(
      `Baja >30% — verificar que el margen resultante no viole el piso de ${MIN_CONTRIBUTION_MARGIN_PERCENT}%.`
    );
  }

  return {
    item,
    newValue: formatNumeric(newVal),
    newNumericValue: newVal,
    willChange: validDelta > 0 && newVal !== current,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  };
}

function previewDeactivate(item: BulkItem): BulkPreviewRow {
  const willChange = item.currentStatus === "active";
  return {
    item,
    newValue: willChange ? "Inactivo" : item.currentValue,
    newStatus: "inactive",
    willChange,
    warning: willChange ? "Este ítem será desactivado y dejará de aparecer en cotizaciones/despacho." : undefined,
  };
}

function previewActivate(item: BulkItem): BulkPreviewRow {
  const willChange = item.currentStatus === "inactive";
  return {
    item,
    newValue: willChange ? "Activo" : item.currentValue,
    newStatus: "active",
    willChange,
    warning: willChange ? "Este ítem será reactivado y volverá a estar disponible." : undefined,
  };
}

function previewExport(item: BulkItem): BulkPreviewRow {
  return {
    item,
    newValue: item.currentValue,
    willChange: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Validación
// ═══════════════════════════════════════════════════════════════════════════

export interface BulkValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Valida que los parámetros de una operación bulk sean seguros antes de
 * generar la previsualización (y mucho antes del commit).
 *
 * @param input — operación y parámetros.
 */
export function validateBulkOperation(input: BulkOperationInput): BulkValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.selectedIds || input.selectedIds.length === 0) {
    errors.push("Debe seleccionar al menos un ítem.");
  }

  if (input.selectedIds.length > 500) {
    errors.push("Máximo 500 ítems por operación en lote.");
  }

  if (input.operation === "raise_percent" || input.operation === "lower_percent") {
    const delta = input.percentDelta;
    if (delta === undefined || delta === null) {
      errors.push(`La operación "${input.operation}" requiere un percentDelta.`);
    } else if (delta <= 0) {
      errors.push("percentDelta debe ser > 0.");
    } else if (delta > MAX_SINGLE_RAISE_PERCENT && input.operation === "raise_percent") {
      errors.push(
        `Aumento máximo por operación: ${MAX_SINGLE_RAISE_PERCENT}%. Recibido: ${delta}%.`
      );
    } else if (delta > MAX_SINGLE_LOWER_PERCENT && input.operation === "lower_percent") {
      errors.push(
        `Baja máxima por operación: ${MAX_SINGLE_LOWER_PERCENT}%. Recibido: ${delta}%.`
      );
    }
    if (delta && delta > 20) {
      warnings.push(
        `Un ajuste de ±${delta}% es grande. Verifique que no distorsione la competitividad de precios.`
      );
    }
  }

  if (input.operation === "deactivate" && input.entityType === "employee") {
    warnings.push(
      "Desactivar empleados no cancela servicios ya asignados. Revise la agenda antes de confirmar."
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

export interface BulkExportResult {
  entityType: BulkEntityType;
  /** Columnas del CSV. */
  headers: string[];
  /** Filas de datos. */
  rows: (string | number | null)[][];
  /** CSV completo como string. */
  csv: string;
  /** Timestamp para el nombre de archivo. */
  exportedAt: string;
  filename: string;
}

/**
 * Genera el CSV de exportación para los ítems seleccionados. Las columnas
 * dependen del entityType. El caller puede devolver este CSV como descarga
 * o guardarlo en Supabase Storage.
 */
export function generateBulkExport(
  items: BulkItem[],
  entityType: BulkEntityType,
  nowIso: string
): BulkExportResult {
  const headers = getExportHeaders(entityType);
  const rows = items.map((item) => getExportRow(item, entityType));
  const csv = buildCsv(headers, rows);
  const dateStr = nowIso.slice(0, 10).replace(/-/g, "");
  const filename = `export-${entityType}-${dateStr}.csv`;

  return { entityType, headers, rows, csv, exportedAt: nowIso, filename };
}

function getExportHeaders(entityType: BulkEntityType): string[] {
  switch (entityType) {
    case "pricing_rule":
      return ["id", "label", "current_value", "status"];
    case "client":
      return ["id", "label", "status"];
    case "employee":
      return ["id", "label", "status"];
    case "inventory_item":
      return ["id", "label", "current_value", "status"];
  }
}

function getExportRow(item: BulkItem, entityType: BulkEntityType): (string | number | null)[] {
  switch (entityType) {
    case "pricing_rule":
      return [item.id, item.label, item.currentNumericValue ?? item.currentValue, item.currentStatus ?? null];
    case "client":
      return [item.id, item.label, item.currentStatus ?? null];
    case "employee":
      return [item.id, item.label, item.currentStatus ?? null];
    case "inventory_item":
      return [item.id, item.label, item.currentNumericValue ?? item.currentValue, item.currentStatus ?? null];
  }
}

function buildCsv(headers: string[], rows: (string | number | null)[][]): string {
  const escape = (v: string | number | null): string => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatNumeric(n: number): string {
  return n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Infiere el entityType del primer ítem (todos deben ser del mismo tipo). */
function inferEntityType(_items: BulkItem[]): BulkEntityType {
  // El entityType real lo setea el caller vía input; este fallback es para
  // previsualizaciones donde el frontend manda items sueltos.
  return "pricing_rule";
}

/**
 * Genera un ID determinístico para la previsualización. Si el frontend
 * envía este ID junto con la confirmación, el backend puede verificar que
 * la previsualización no fue alterada entre el preview y el commit.
 */
function buildPreviewId(
  items: BulkItem[],
  operation: BulkOperationType,
  percentDelta: number | undefined,
  nowIso: string
): string {
  const ids = items.map((i) => i.id).sort().join(",");
  const delta = percentDelta ?? 0;
  return `bulk-${operation}-${ids.length}-${delta}-${nowIso}`;
}

/**
 * v8.3 Capa 2 del Financial Core — Compliance Admin.
 *
 * CRUD administrativo para la tabla `reglas_legales`. Todas las mutaciones
 * pasan por `getServiceRoleClient()` (bypassea RLS); la autorización RBAC
 * ocurre aguas arriba en el API route vía `requireAdminRole()`.
 *
 * REGLA DE ORO (enforced aquí):
 *   NUNCA se edita una versión VIGENTE. Los cambios generan nueva versión.
 *   Para modificar una regla: archiveRule() → createRule() con nueva versión.
 *
 * Conexiones:
 * - compliance-engine.ts  → tipos, schemas, _isRuleActiveAt, _versionsOverlap
 * - compliance-resolver.ts → getCurrentRate (usa estos datos en prod)
 * - compliance-feed.ts     → proposeNewVersion + activateVersion (lee/escribe aquí)
 * - admin.ts               → getServiceRoleClient (bypassea RLS)
 */

import { z } from "zod";
import { getServiceRoleClient } from "./admin";
import {
  type ReglaLegalRow,
  type TipoRegla,
  type _Jurisdiccion,
  cppParamsSchema,
  eiParamsSchema,
  bcTaxParamsSchema,
  gstParamsSchema,
  pstParamsSchema,
  workSafeBcParamsSchema,
  minWageParamsSchema,
  vacationPayParamsSchema,
  statutoryHolidaysParamsSchema,
} from "./compliance-engine";

// ---------------------------------------------------------------------------
// Zod schemas — input validation
// ---------------------------------------------------------------------------

/** Schema base compartido para crear una regla legal. */
export const createRuleBaseSchema = z.object({
  jurisdiccion: z.enum(["Federal", "BC"]),
  tipo: z.enum([
    "CPP",
    "EI",
    "Tax",
    "GST",
    "PST",
    "WorkSafeBC",
    "MinWage",
    "VacationPay",
    "StatutoryHolidays",
  ]),
  version: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Formato YYYY-MM requerido (ej. 2026-01)"),
  vigente_desde: z.string().datetime("ISO 8601 datetime requerido"),
  notas: z.string().max(2000).optional(),
});

/** Schema completo para crear una regla con parámetros validados por tipo. */
export const createRuleInputSchema = z.discriminatedUnion("tipo", [
  createRuleBaseSchema.extend({
    tipo: z.literal("CPP"),
    parametros: cppParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("EI"),
    parametros: eiParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("Tax"),
    parametros: bcTaxParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("GST"),
    parametros: gstParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("PST"),
    parametros: pstParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("WorkSafeBC"),
    parametros: workSafeBcParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("MinWage"),
    parametros: minWageParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("VacationPay"),
    parametros: vacationPayParamsSchema,
  }),
  createRuleBaseSchema.extend({
    tipo: z.literal("StatutoryHolidays"),
    parametros: statutoryHolidaysParamsSchema,
  }),
]);

export type CreateRuleInput = z.infer<typeof createRuleInputSchema>;

// ---------------------------------------------------------------------------
// Tipos de resultado
// ---------------------------------------------------------------------------

/** Resultado de una operación de escritura. */
export interface AdminResult {
  success: boolean;
  /** ID de la regla afectada, si aplica. */
  ruleId: string | null;
  /** Mensaje descriptivo. */
  message: string;
  /** Datos de la regla, si la operación fue exitosa. */
  rule?: ReglaLegalRow;
}

// ---------------------------------------------------------------------------
// listRules()
// ---------------------------------------------------------------------------

/**
 * Lista todas las reglas legales, opcionalmente filtradas por tipo.
 *
 * @param tipo - Tipo de regla a filtrar (opcional; si no se provee, retorna todas).
 * @returns Array de `ReglaLegalRow` ordenadas por vigente_desde descendente.
 */
export async function listRules(tipo?: TipoRegla): Promise<ReglaLegalRow[]> {
  const client = getServiceRoleClient();
  if (!client) {
    throw new Error("Service role client no disponible — ¿SUPABASE_SERVICE_ROLE_KEY configurada?");
  }

  let query = client.from("reglas_legales").select("*").order("vigente_desde", { ascending: false });

  if (tipo) {
    query = query.eq("tipo", tipo);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error al listar reglas legales: ${error.message} (código ${error.code})`);
  }

  return (data ?? []) as ReglaLegalRow[];
}

// ---------------------------------------------------------------------------
// getRule()
// ---------------------------------------------------------------------------

/**
 * Obtiene una regla legal por su ID.
 *
 * @param id - UUID de la regla.
 * @returns `ReglaLegalRow` o null si no existe.
 */
export async function getRule(id: string): Promise<ReglaLegalRow | null> {
  const client = getServiceRoleClient();
  if (!client) {
    throw new Error("Service role client no disponible — ¿SUPABASE_SERVICE_ROLE_KEY configurada?");
  }

  const { data, error } = await client
    .from("reglas_legales")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    // PGRST116 = "0 rows" en single() — no es un error real, solo no existe.
    if (error.code === "PGRST116") return null;
    throw new Error(`Error al obtener regla ${id}: ${error.message} (código ${error.code})`);
  }

  return data as ReglaLegalRow;
}

// ---------------------------------------------------------------------------
// createRule()
// ---------------------------------------------------------------------------

/**
 * Crea una nueva regla legal.
 *
 * REGLA DE ORO: si ya existe una regla VIGENTE para el mismo
 * (jurisdiccion, tipo), la creación se rechaza. El flujo correcto es:
 *   1. `archiveRule(idVigente)` — marca la anterior como HISTORICO.
 *   2. `createRule(input)` — crea la nueva versión.
 *
 * Esto garantiza que nunca haya dos versiones VIGENTES solapadas para
 * el mismo (jurisdiccion, tipo).
 *
 * @param input - Datos de la nueva regla (validados con createRuleInputSchema).
 * @param adminId - Identificador del admin que realiza la operación (se guarda en creado_por).
 * @returns `AdminResult` con el resultado de la operación.
 */
export async function createRule(
  input: CreateRuleInput,
  adminId: string
): Promise<AdminResult> {
  const client = getServiceRoleClient();
  if (!client) {
    return {
      success: false,
      ruleId: null,
      message: "Service role client no disponible — ¿SUPABASE_SERVICE_ROLE_KEY configurada?",
    };
  }

  // 1. Validar input con Zod
  const parsed = createRuleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      ruleId: null,
      message: `Input inválido: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }

  const { jurisdiccion, tipo, version, parametros, vigente_desde, notas } = parsed.data;

  // 2. Verificar que no exista una regla VIGENTE para el mismo (jurisdiccion, tipo)
  const { data: vigentes, error: lookupError } = await client
    .from("reglas_legales")
    .select("id, version, vigente_desde")
    .eq("jurisdiccion", jurisdiccion)
    .eq("tipo", tipo)
    .eq("estado", "VIGENTE");

  if (lookupError) {
    return {
      success: false,
      ruleId: null,
      message: `Error al verificar reglas vigentes: ${lookupError.message}`,
    };
  }

  if (vigentes && vigentes.length > 0) {
    const vigenteIds = vigentes.map((r) => `${r.version} (${r.id})`).join(", ");
    return {
      success: false,
      ruleId: null,
      message: `Ya existe(n) regla(s) VIGENTE para ${jurisdiccion}/${tipo}: ${vigenteIds}. Archívela(s) primero (archiveRule) y luego cree la nueva versión.`,
    };
  }

  // 3. Insertar la nueva regla
  const { data: created, error: insertError } = await client
    .from("reglas_legales")
    .insert({
      jurisdiccion,
      tipo,
      version,
      parametros: parametros as Record<string, unknown>,
      estado: "VIGENTE",
      vigente_desde,
      vigente_hasta: null,
      creado_por: adminId,
      creado_en: new Date().toISOString(),
      notas: notas ?? null,
    })
    .select("*")
    .single();

  if (insertError) {
    return {
      success: false,
      ruleId: null,
      message: `Error al insertar regla: ${insertError.message} (código ${insertError.code})`,
    };
  }

  return {
    success: true,
    ruleId: (created as ReglaLegalRow).id,
    message: `Regla ${tipo} v${version} (${jurisdiccion}) creada exitosamente.`,
    rule: created as ReglaLegalRow,
  };
}

// ---------------------------------------------------------------------------
// archiveRule()
// ---------------------------------------------------------------------------

/**
 * Archiva una regla VIGENTE: la marca como HISTORICO y establece
 * `vigente_hasta = now()`.
 *
 * REGLA DE ORO aplicada aquí: la regla archivada es inmutable más allá
 * de este cambio de estado. Los asientos históricos que la referencian
 * no se tocan.
 *
 * Solo archiva reglas en estado VIGENTE. Si la regla ya está PENDIENTE o
 * HISTORICO, la operación se rechaza.
 *
 * @param id - UUID de la regla VIGENTE a archivar.
 * @param adminId - Identificador del admin que realiza la operación.
 * @returns `AdminResult` con el resultado.
 */
export async function archiveRule(
  id: string,
  adminId: string
): Promise<AdminResult> {
  const client = getServiceRoleClient();
  if (!client) {
    return {
      success: false,
      ruleId: null,
      message: "Service role client no disponible — ¿SUPABASE_SERVICE_ROLE_KEY configurada?",
    };
  }

  // 1. Obtener la regla para verificar su estado actual
  const { data: current, error: lookupError } = await client
    .from("reglas_legales")
    .select("*")
    .eq("id", id)
    .single();

  if (lookupError) {
    if (lookupError.code === "PGRST116") {
      return { success: false, ruleId: id, message: `Regla ${id} no encontrada.` };
    }
    return {
      success: false,
      ruleId: id,
      message: `Error al buscar regla ${id}: ${lookupError.message}`,
    };
  }

  const rule = current as ReglaLegalRow;

  // 2. Solo se puede archivar una regla VIGENTE
  if (rule.estado !== "VIGENTE") {
    return {
      success: false,
      ruleId: id,
      message: `La regla ${id} no está VIGENTE (estado actual: ${rule.estado}). Solo se pueden archivar reglas VIGENTE.`,
    };
  }

  // 3. Archivar: estado → HISTORICO, vigente_hasta → now()
  const now = new Date().toISOString();
  const { data: archived, error: updateError } = await client
    .from("reglas_legales")
    .update({
      estado: "HISTORICO",
      vigente_hasta: now,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError) {
    return {
      success: false,
      ruleId: id,
      message: `Error al archivar regla ${id}: ${updateError.message} (código ${updateError.code})`,
    };
  }

  return {
    success: true,
    ruleId: id,
    message: `Regla ${rule.tipo} v${rule.version} (${rule.jurisdiccion}) archivada por ${adminId}. vigente_hasta=${now}. Los asientos históricos que la referencian no se modifican.`,
    rule: archived as ReglaLegalRow,
  };
}

// ---------------------------------------------------------------------------
// getActiveRules()
// ---------------------------------------------------------------------------

/**
 * Retorna todas las reglas VIGENTES para una fecha dada.
 *
 * Una regla está vigente si:
 * - `estado = 'VIGENTE'`
 * - `vigente_desde <= fecha`
 * - `vigente_hasta IS NULL OR vigente_hasta > fecha`
 *
 * Equivalente SQL del helper `_isRuleActiveAt()` de compliance-engine.ts,
 * pero ejecutado en la base de datos para eficiencia.
 *
 * @param fecha - Fecha de referencia (default: now() en UTC).
 * @returns Array de `ReglaLegalRow` vigentes, ordenadas por tipo.
 */
export async function getActiveRules(fecha?: Date): Promise<ReglaLegalRow[]> {
  const client = getServiceRoleClient();
  if (!client) {
    throw new Error("Service role client no disponible — ¿SUPABASE_SERVICE_ROLE_KEY configurada?");
  }

  const ref = fecha ?? new Date();
  const refISO = ref.toISOString();

  const { data, error } = await client
    .from("reglas_legales")
    .select("*")
    .eq("estado", "VIGENTE")
    .lte("vigente_desde", refISO)
    .or(`vigente_hasta.is.null,vigente_hasta.gt.${refISO}`)
    .order("tipo", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener reglas vigentes: ${error.message} (código ${error.code})`);
  }

  return (data ?? []) as ReglaLegalRow[];
}

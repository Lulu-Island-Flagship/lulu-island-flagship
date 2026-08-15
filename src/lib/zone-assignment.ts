/**
 * v8.3 E4 (D.7) — Conecta el reparto puro de zone-reparto.ts a una orden
 * real: calcula qué zonas le tocan a cada empleado asignado y lo persiste en
 * `assignments.zones`.
 *
 * Antes de esto, assignZonesToOperators() existía y tenía tests, pero nada
 * la llamaba con datos reales — un empleado veía y podía marcar TODAS las
 * zonas de cualquier servicio sin importar N. Este módulo es el puente:
 * ordenAndComputeZoneAssignment() decide el plan (función pura, testeable),
 * ensureZoneAssignment() lo persiste contra Supabase (I/O, no testeable
 * unitariamente — mismo patrón que closure-protocol.ts / servicio/route.ts).
 */

import { assignZonesToOperators, type ZoneWeight } from "./zone-reparto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AssignmentRow {
  id: string;
  employeeId: string;
  /** Orden estable (assigned_at) para que operatorIndex sea determinista. */
  assignedAt: string;
  existingZones: string[] | null;
}

export interface ZonePlanResult {
  /** employeeId -> zonas asignadas. Si N<2, cada operario recibe TODAS las zonas (sin reparto real). */
  plan: Map<string, string[]>;
  /** true si hubo reparto real (N>=2 y >=2 zonas); false si N<2 o no hay zonas que repartir. */
  wasSplit: boolean;
}

/**
 * Función pura: dado el set de operarios (ya ordenados de forma estable) y
 * las zonas con su peso, decide el plan de reparto. No toca la red.
 */
export function computeZonePlan(
  operators: Pick<AssignmentRow, "employeeId">[],
  zoneWeights: ZoneWeight[]
): ZonePlanResult {
  const plan = new Map<string, string[]>();

  if (operators.length === 0) {
    return { plan, wasSplit: false };
  }

  // N=1 (o 0 zonas que repartir): el único operario cubre todo. No es
  // "reparto" en el sentido D.7 (esa regla dura solo aplica con N>=2).
  if (operators.length < 2 || zoneWeights.length === 0) {
    const allZones = zoneWeights.map((z) => z.zone);
    for (const op of operators) plan.set(op.employeeId, allZones);
    return { plan, wasSplit: false };
  }

  const assignments = assignZonesToOperators(zoneWeights, operators.length);
  operators.forEach((op, i) => {
    plan.set(op.employeeId, assignments[i]?.zones ?? []);
  });
  return { plan, wasSplit: true };
}

/**
 * Asegura que la orden tenga su reparto de zonas calculado y persistido.
 * Idempotente: si TODAS las filas de assignments de la orden ya tienen
 * `zones` no-nulo, no recalcula nada (evita reasignar zonas a mitad de
 * jornada si, por ejemplo, se agrega un empleado tarde solo se completa lo
 * faltante). Devuelve el plan final (de DB, ya sea recién calculado o
 * preexistente).
 */
export async function ensureZoneAssignment(
  supabase: SupabaseClient,
  orderId: string
): Promise<Map<string, string[]>> {
  // orders no tiene columna service_subtype propia (solo vive en quotes,
  // migración 001) — se resuelve por el join real orders.quote_id ->
  // quotes.service_subtype. (Ver el mismo bug corregido en
  // servicio/route.ts checkClosureProtocol y servicio/[orderId]/route.ts.)
  const { data: order } = await supabase
    .from("orders")
    .select("quotes:quote_id ( service_subtype )")
    .eq("id", orderId)
    .single();

  const quoteForSubtype = order?.quotes as { service_subtype?: string } | null;
  const serviceSubtype = quoteForSubtype?.service_subtype;

  // A-10 fix (auditoría 2026-07-21): ensureZoneAssignment repartía zonas
  // entre TODOS los operadores de la orden filtrando solo por deleted_at,
  // sin excluir asignaciones con status 'cancelled'/'no_show' (un empleado
  // reemplazado por no-show o removido por el admin puede quedar con la
  // fila viva, solo con status cambiado, sin deleted_at). Ese operador
  // fantasma seguía recibiendo una porción del reparto -- zonas que nunca
  // se completarían porque nadie las trabaja -- bloqueando t_out para
  // siempre en el consumidor (empleado/servicio/route.ts), que exige todas
  // las zonas cerradas. Se excluyen aquí las asignaciones no activas.
  const { data: assignmentRows } = await supabase
    .from("assignments")
    .select("id, employee_id, assigned_at, zones, status")
    .is("deleted_at", null)
    .not("status", "in", "(cancelled,no_show)")
    .eq("order_id", orderId)
    .order("assigned_at", { ascending: true });

  const operators: AssignmentRow[] = (assignmentRows || []).map(
    (r: { id: string; employee_id: string; assigned_at: string; zones: string[] | null }) => ({
      id: r.id,
      employeeId: r.employee_id,
      assignedAt: r.assigned_at,
      existingZones: r.zones,
    })
  );

  if (operators.length === 0) return new Map();

  const alreadyComputed = operators.every((op) => op.existingZones !== null);
  if (alreadyComputed) {
    const plan = new Map<string, string[]>();
    for (const op of operators) plan.set(op.employeeId, op.existingZones || []);
    return plan;
  }

  // A-10 fix (auditoría 2026-07-21): el reparto de zonas incluía zonas
  // add-on aunque la orden no las hubiera comprado (orders.addon_zones).
  // empleado/servicio/route.ts SÍ filtra por is_addon_zone + addon_zones
  // al construir el checklist final que el empleado debe cerrar (líneas
  // ~94-99 de ese archivo), pero el reparto de ESTE módulo no aplicaba el
  // mismo filtro -- el peso de zonas nunca vendidas entraba al cálculo de
  // assignZonesToOperators, sesgando la división de zonas reales entre
  // operadores y pudiendo dejarle a un operador solo zonas que después el
  // consumidor descarta por completo, vaciando su lista de cierre.
  const { data: orderForAddons } = await supabase
    .from("orders")
    .select("addon_zones")
    .eq("id", orderId)
    .maybeSingle();
  const selectedAddonZones = new Set<string>(orderForAddons?.addon_zones || []);

  const { data: checklists } = await supabase
    .from("sop_checklists")
    .select("zone, zone_weight, is_addon_zone")
    .is("deleted_at", null)
    .eq("service_subtype", serviceSubtype || "")
    .eq("is_active", true);

  const zoneWeights: ZoneWeight[] = (checklists || [])
    .filter((c: { zone: string; is_addon_zone?: boolean }) => !c.is_addon_zone || selectedAddonZones.has(c.zone))
    .map((c: { zone: string; zone_weight: number }) => ({ zone: c.zone, weight: Number(c.zone_weight) || 1.0 }));

  const { plan } = computeZonePlan(operators, zoneWeights);

  await Promise.all(
    operators.map((op) =>
      supabase
        .from("assignments")
        .update({ zones: plan.get(op.employeeId) ?? [] })
        .eq("id", op.id)
    )
  );

  return plan;
}

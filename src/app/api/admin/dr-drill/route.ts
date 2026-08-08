import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import {
  evaluateDrillResult,
  computeAllDrillOverdueStatuses,
  type IntegrityCheckResult,
  type DrillType,
} from "@/lib/dr-drill";

// v8.3 E11.3/E11.4 — Recuperación de desastres declarada y probada.
//
// GET  /api/admin/dr-drill  — historial de simulacros + RTO declarados (migraciones 095/096).
// POST /api/admin/dr-drill  — corre (o registra) un simulacro:
//   - drillType='restore_verification': ejecuta dr_drill_integrity_check() (migración 097)
//     en la base actual, compara contra el RTO del data_type indicado y guarda el resultado.
//     Esto verifica la SALUD de la base a la que está conectado el servidor. Si el admin
//     restauró un pg_dump en staging y apuntó temporalmente esta app a esa base, el mismo
//     botón sirve como verificación del restore real — ver comentario en migración 097.
//   - otros drillType (succession_simulation, emergency_kit_check, fallback_no_admin): son
//     bitácora MANUAL — no hay chequeo automático posible desde SQL, así que el admin debe
//     indicar manualResult explícitamente. Nunca se infiere 'pass' sin que alguien lo confirme.
//
// Recurso RBAC: no existe un AdminResource dedicado a "disaster_recovery" y esta tarea tiene
// prohibido tocar admin-rbac.ts. Se usa 'feature_flags' (solo owner_admin, "interruptores del
// sistema") por ser el recurso existente más cercano a una operación crítica de infraestructura
// reservada exclusivamente al dueño.

const DRILL_TYPES = [
  "restore_verification",
  "succession_simulation",
  "emergency_kit_check",
  "fallback_no_admin",
] as const satisfies readonly DrillType[];

// Tabla crítica que debe tener datos tras cualquier restauración real; si el restore la
// dejó vacía, es indicio de restauración incompleta.
const CRITICAL_NON_EMPTY_TABLES = ["orders", "quotes", "employees"];

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("feature_flags", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [{ data: drills, error: drillsError }, { data: rtoTargets, error: rtoError }] = await Promise.all([
    auth.supabase
      .from("disaster_recovery_drills")
      .select("id, drill_type, tested_scope, result, verification_details, duration_seconds, notes, run_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    auth.supabase
      .from("rto_targets")
      .select("id, data_type, rto_hours, recovery_method, is_example, source, notes")
      .order("rto_hours", { ascending: true }),
  ]);

  if (drillsError) {
    console.error("admin/dr-drill error:", drillsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (rtoError) {
    console.error("admin/dr-drill error:", rtoError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  // Fecha del simulacro MÁS RECIENTE por tipo (sin importar pass/fail/partial
  // -- ver comentario en dr-drill.ts) para calcular vencimiento del intervalo
  // declarado en E11.4.
  const lastRunByType: Partial<Record<DrillType, string>> = {};
  for (const d of drills ?? []) {
    const type = d.drill_type as DrillType;
    if (!lastRunByType[type]) {
      lastRunByType[type] = d.created_at as string;
    }
  }
  const overdueStatuses = computeAllDrillOverdueStatuses(lastRunByType, new Date().toISOString());

  return NextResponse.json(
    { drills: drills ?? [], rtoTargets: rtoTargets ?? [], overdueStatuses },
    { status: 200 }
  );
}

interface DrillRequestBody {
  drillType?: string;
  testedScope?: string;
  notes?: string;
  durationSeconds?: number;
  /** Requerido para drillType != 'restore_verification' — nadie puede automatizar esto. */
  manualResult?: "pass" | "fail" | "partial";
  /** data_type de rto_targets contra el que se compara la duración (por defecto: supabase_extended_outage) */
  rtoDataType?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("feature_flags", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "feature_flags", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const { supabase, user } = auth;

  let body: DrillRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const drillType = body.drillType as DrillType;
  if (!DRILL_TYPES.includes(drillType)) {
    return NextResponse.json({ error: `drillType debe ser uno de: ${DRILL_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!body.testedScope || body.testedScope.trim().length === 0) {
    return NextResponse.json({ error: "testedScope es obligatorio (qué se probó, en texto)" }, { status: 400 });
  }

  if (drillType !== "restore_verification") {
    // Bitácora manual — el admin ya corrió el simulacro fuera del sistema (kit físico,
    // sucesión en staging, Fallback sin admin) y solo registra el resultado.
    if (!body.manualResult || !["pass", "fail", "partial"].includes(body.manualResult)) {
      return NextResponse.json(
        { error: "manualResult ('pass'|'fail'|'partial') es obligatorio para simulacros no automatizados" },
        { status: 400 }
      );
    }
    const { data, error } = await supabase
      .from("disaster_recovery_drills")
      .insert({
        drill_type: drillType,
        tested_scope: body.testedScope.trim(),
        result: body.manualResult,
        verification_details: { manual: true, recorded_by: user.id },
        duration_seconds: body.durationSeconds ?? null,
        notes: body.notes ?? null,
        run_by: user.id,
      })
      .select()
      .single();
    if (error) {
      console.error("admin/dr-drill error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ drill: data }, { status: 201 });
  }

  // drillType === 'restore_verification': corre el chequeo automático real.
  try {
  const startedAt = Date.now();
  const { data: rpcResult, error: rpcError } = await supabase.rpc("dr_drill_integrity_check");
  if (rpcError) {
    return safeErrorResponse(rpcError, 500, "Chequeo de integridad falló. Revise los logs del servidor.");
  }
  const elapsedSeconds = body.durationSeconds ?? Math.round((Date.now() - startedAt) / 1000);

  const rowCounts = (rpcResult?.row_counts ?? {}) as Record<string, number>;
  const referentialIntegrity = (rpcResult?.referential_integrity ?? {}) as Record<string, number>;
  const check: IntegrityCheckResult = {
    rowCounts,
    referentialIntegrity,
    passed: Boolean(rpcResult?.passed),
  };

  const rtoDataType = body.rtoDataType ?? "supabase_extended_outage";
  const { data: rtoRow } = await supabase
    .from("rto_targets")
    .select("rto_hours")
    .eq("data_type", rtoDataType)
    .maybeSingle();

  const evaluation = evaluateDrillResult(check, {
    durationSeconds: elapsedSeconds,
    rtoHours: rtoRow?.rto_hours ?? undefined,
    criticalTablesExpectedNonEmpty: CRITICAL_NON_EMPTY_TABLES,
  });

  const { data: drill, error: insertError } = await supabase
    .from("disaster_recovery_drills")
    .insert({
      drill_type: drillType,
      tested_scope: body.testedScope.trim(),
      result: evaluation.result,
      verification_details: {
        checked_at: rpcResult?.checked_at ?? new Date().toISOString(),
        row_counts: rowCounts,
        referential_integrity: referentialIntegrity,
        reasons: evaluation.reasons,
        compared_against_rto_data_type: rtoDataType,
        within_rto: evaluation.withinRto,
      },
      duration_seconds: elapsedSeconds,
      notes: body.notes ?? null,
      run_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    console.error("admin/dr-drill error:", insertError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ drill, evaluation }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

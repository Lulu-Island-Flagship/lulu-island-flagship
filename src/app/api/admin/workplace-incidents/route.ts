import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { computeWorkSafeBCReportStatus, buildPrefilledReportFields } from "@/lib/workplace-incident";

/**
 * GET  /api/admin/workplace-incidents — lista con estado del cronómetro de
 *      72h (pending/due_soon/overdue/filed_on_time/filed_late) y los campos
 *      pre-llenados listos para copiar al formulario real de WorkSafeBC.
 * POST /api/admin/workplace-incidents — { action: "mark_filed", id, referenceNumber? }
 *
 * Recurso RBAC: 'risk_assessments' (owner_admin + ops_coordinator) -- misma
 * sensibilidad de campo/seguridad que la pre-evaluación de riesgo y las
 * excepciones de clima, ya existe en admin-rbac.ts.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("workplace_incidents")
    .select(
      `id, employee_id, incident_datetime, location_description, body_part_affected, injury_description,
       medical_attention_type, witnesses, immediate_action_taken, worksafebc_report_due_at,
       worksafebc_report_filed_at, worksafebc_reference_number, notes, created_at,
       employees:employee_id ( name )`
    )
    .is("deleted_at", null)
    .order("incident_datetime", { ascending: false })
    .limit(100);

  if (error) {
    console.error("admin/workplace-incidents error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const incidents = (data || []).map((row) => {
    const employeeName = (row.employees as unknown as { name: string } | null)?.name ?? "(desconocido)";
    const status = computeWorkSafeBCReportStatus({
      dueAtIso: row.worksafebc_report_due_at,
      filedAtIso: row.worksafebc_report_filed_at,
      nowIso,
    });
    const prefilledReport = buildPrefilledReportFields({
      employeeName,
      incidentDatetimeIso: row.incident_datetime,
      locationDescription: row.location_description,
      bodyPartAffected: row.body_part_affected,
      injuryDescription: row.injury_description,
      medicalAttentionType: row.medical_attention_type,
      witnesses: row.witnesses,
      immediateActionTaken: row.immediate_action_taken,
    });
    return { ...row, employeeName, status, prefilledReport };
  });

  return NextResponse.json({ workplaceIncidents: incidents }, { status: 200 });
}

interface MarkFiledBody {
  action?: string;
  id?: string;
  referenceNumber?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("risk_assessments", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "risk_assessments", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
  const { supabase } = auth;

  let body: MarkFiledBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.action !== "mark_filed") {
    return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
  }
  if (!body.id) {
    return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
  }

  const { data: filerEmployee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("workplace_incidents")
    .update({
      worksafebc_report_filed_at: new Date().toISOString(),
      worksafebc_reference_number: body.referenceNumber?.trim() || null,
      filed_by: filerEmployee?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .select()
    .single();

  if (error) {
    console.error("admin/workplace-incidents error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ workplaceIncident: data }, { status: 200 });
}


import { NextRequest, NextResponse } from "next/server";
import { computeWorkSafeBCDeadline } from "@/lib/workplace-incident";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
const VALID_MEDICAL_ATTENTION = ["none", "first_aid", "clinic", "hospital"];

// POST /api/employee/workplace-incident — reportar un incidente CON lesión
// (distinto de near-miss, que es explícitamente sin lesión). v8.3 E7
// (D.10#6): dispara el cronómetro de 72h para el reporte WorkSafeBC.
// Cualquier empleado autenticado puede reportar -- a sí mismo o como testigo
// de un compañero -- para que "alerta admin inmediata" no tenga fricción de
// rol.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      employeeId,
      incidentDatetime,
      locationDescription,
      bodyPartAffected,
      injuryDescription,
      medicalAttentionType,
      witnesses,
      immediateActionTaken,
      orderId,
      clientPropertyId,
    } = body;

    if (!injuryDescription || typeof injuryDescription !== "string" || injuryDescription.trim().length === 0) {
      return NextResponse.json({ error: "injuryDescription es obligatorio" }, { status: 400 });
    }
    if (!incidentDatetime || Number.isNaN(new Date(incidentDatetime).getTime())) {
      return NextResponse.json({ error: "incidentDatetime (ISO) es obligatorio" }, { status: 400 });
    }

    // v8.3 auditoría 2026-07-21 (D-P1-7): incidentDatetime llegaba crudo
    // del body sin validar rango -- 1990 o 2050 generaban un deadline
    // WorkSafeBC ya vencido o absurdamente lejano. Se acepta hasta 1h de
    // adelanto (margen de reloj) y hasta 365 días atrás (después de eso,
    // el reporte tardío es un caso administrativo distinto, no un typo).
    const incidentDate = new Date(incidentDatetime);
    const now = Date.now();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const MAX_PAST_MS = 365 * 24 * 60 * 60 * 1000;
    if (incidentDate.getTime() > now + ONE_HOUR_MS) {
      return NextResponse.json({ error: "incidentDatetime no puede estar en el futuro" }, { status: 400 });
    }
    if (incidentDate.getTime() < now - MAX_PAST_MS) {
      return NextResponse.json(
        { error: "incidentDatetime no puede ser de hace más de 365 días" },
        { status: 400 }
      );
    }

    const medicalType = medicalAttentionType && VALID_MEDICAL_ATTENTION.includes(medicalAttentionType)
      ? medicalAttentionType
      : "none";

    const supabase = await createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee: reporter, error: reporterError, status: reporterStatus } = await requireActiveEmployee(supabase, user.id);

    if (!reporter) {
      return NextResponse.json({ error: reporterError }, { status: reporterStatus });
    }

    // Si no se especifica employeeId (el lesionado), se asume que el
    // reportero es el propio afectado.
    //
    // v8.3 auditoría 2026-07-21 (D-P1-7): employeeId llegaba crudo del
    // body sin validar -- un empleado podía reportar una lesión a nombre
    // de CUALQUIER UUID, real o inventado. Se exige que exista un
    // empleado activo con ese id antes de aceptar el reporte.
    let affectedEmployeeId = reporter.id;
    if (employeeId !== undefined && employeeId !== null && employeeId !== "") {
      if (typeof employeeId !== "string") {
        return NextResponse.json({ error: "employeeId debe ser un string" }, { status: 400 });
      }
      const { data: affectedEmployee, error: affectedError } = await supabase
        .from("employees")
        .select("id")
        .eq("id", employeeId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .maybeSingle();

      if (affectedError) {
        console.error("affectedError:", affectedError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      if (!affectedEmployee) {
        return NextResponse.json({ error: "employeeId no corresponde a un empleado existente" }, { status: 400 });
      }
      affectedEmployeeId = affectedEmployee.id;
    }

    // v8.3 IDOR fix: verify reporter is assigned to orderId before allowing the incident to be linked
    if (orderId) {
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("id")
        .eq("order_id", orderId)
        .eq("employee_id", reporter.id)
        .maybeSingle();

      if (assignmentError) {
        console.error("assignmentError:", assignmentError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      if (!assignment) {
        return NextResponse.json({ error: "You are not assigned to this order" }, { status: 403 });
      }
    }

    const { data, error } = await supabase
      .from("workplace_incidents")
      .insert({
        employee_id: affectedEmployeeId,
        reported_by: reporter.id,
        order_id: orderId || null,
        client_property_id: clientPropertyId || null,
        incident_datetime: incidentDatetime,
        location_description: locationDescription || null,
        body_part_affected: bodyPartAffected || null,
        injury_description: injuryDescription.trim(),
        medical_attention_type: medicalType,
        witnesses: witnesses || null,
        immediate_action_taken: immediateActionTaken || null,
        worksafebc_report_due_at: computeWorkSafeBCDeadline(incidentDatetime),
      })
      .select("id, incident_datetime, worksafebc_report_due_at")
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ workplaceIncident: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

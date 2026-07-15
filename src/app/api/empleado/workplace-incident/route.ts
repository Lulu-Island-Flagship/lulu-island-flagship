import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { computeWorkSafeBCDeadline } from "@/lib/workplace-incident";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

const VALID_MEDICAL_ATTENTION = ["none", "first_aid", "clinic", "hospital"];

// POST /api/empleado/workplace-incident — reportar un incidente CON lesión
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
    const medicalType = medicalAttentionType && VALID_MEDICAL_ATTENTION.includes(medicalAttentionType)
      ? medicalAttentionType
      : "none";

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: reporter } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!reporter) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Si no se especifica employeeId (el lesionado), se asume que el
    // reportero es el propio afectado.
    const affectedEmployeeId = employeeId || reporter.id;

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ workplaceIncident: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

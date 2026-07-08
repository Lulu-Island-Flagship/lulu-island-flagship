import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/qc — grid de servicios para QC review
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "50"), 1), 200);

    const { data, error } = await supabase
      .from("qc_reviews")
      .select(`
        id,
        order_id,
        employee_id,
        status,
        note,
        reviewed_at,
        created_at,
        orders:order_id (service_date, service_time),
        employees:employee_id (name, trust_level)
      `)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reviews: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/qc — crear QC review (auto-aprobar élite con muestreo)
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { orderId, employeeId } = body;

    if (!orderId || !employeeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verificar nivel de confianza del empleado (deshabilitado hasta detección de gaming)
    // const { data: employee } = await supabase
    //   .from("employees")
    //   .select("trust_level")
    //   .eq("id", employeeId)
    //   .single();

    const isElite = false; // DISABLED: employee?.trust_level === "elite";
    const isSampled = false; // DISABLED: Math.random() < 0.10; // 10% muestreo

    // TODO: Implementar detección de gaming antes de habilitar auto-approval en producción real.
    // El spec requiere: si >15% de rechazos en muestreo, revocar auto-aprobación,
    // revisar retroactivamente últimos 10 servicios, recalcular score.
    // Segunda detección = suspensión documentada.
    // Sin este control, un empleado podría manipular el sistema para mantener auto-approval.
    // BLOQUEANTE antes de usar auto-approval con empleados reales.
    // FORZAR muro QC para todos hasta que exista detección de gaming.

    let reviewStatus = "pending";
    let samplingReason = null;

    if (isElite && !isSampled) {
      reviewStatus = "auto";
      samplingReason = "elite_auto_approved";
    }

    const { data, error } = await supabase
      .from("qc_reviews")
      .insert({
        order_id: orderId,
        employee_id: employeeId,
        status: reviewStatus,
        sampling_reason: samplingReason,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ review: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

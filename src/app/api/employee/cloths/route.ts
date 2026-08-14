
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { getVancouverTodayString } from "@/lib/date-utils";
import { safeErrorResponse } from "@/lib/api-errors";
const VALID_COLORS = ["red", "blue", "green", "yellow", "white", "black"];
const VALID_STAGES = ["clean", "in_use", "dirty", "washing", "warehouse", "vehicle"];

// GET /api/employee/cloths — ultimo conteo registrado por color+etapa (hoy)
export async function GET() {
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fix auditoría implacable (2026-07-26, #4 de 3 APIs sin ningún check de
  // empleado): este GET leía towel_cycle_log de hoy con SOLO getUser() --
  // ni siquiera verificaba que el llamador fuera un empleado activo.
  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const today = getVancouverTodayString();
  const { data, error } = await supabase
    .from("towel_cycle_log")
    .select("id, color, stage, count, vehicle_id, recorded_at")
    .gte("recorded_at", today)
    .order("recorded_at", { ascending: false });

  if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }
  return NextResponse.json({ logs: data || [] }, { status: 200 });
}

// POST /api/employee/cloths — v8.3 D.7.3: conteo simple por COLOR, nunca por unidad.
export async function POST(request: NextRequest) {
  const supabase = await createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const { color, stage, count, vehicleId } = body;

    if (!VALID_COLORS.includes(color)) {
      return NextResponse.json({ error: `color inválido. Debe ser uno de: ${VALID_COLORS.join(", ")}` }, { status: 400 });
    }
    if (!VALID_STAGES.includes(stage)) {
      return NextResponse.json({ error: `stage inválido. Debe ser uno de: ${VALID_STAGES.join(", ")}` }, { status: 400 });
    }
    // Fix (auditoría 2026-07-31, #16): antes no había tope superior --
    // servía cualquier número positivo, incluidos valores absurdos por
    // typo. El límite de 999 es el mismo que ahora aplica el input
    // client-side (min/max), reforzado server-side.
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0 || count > 999) {
      return NextResponse.json({ error: "count debe ser un número entre 0 y 999" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("towel_cycle_log")
      .insert({
        color,
        stage,
        count,
        vehicle_id: vehicleId || null,
        recorded_by: employee.id,
      })
      .select()
      .single();

    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

    return NextResponse.json({ log: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

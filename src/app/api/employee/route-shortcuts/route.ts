
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
// v8.3 E8 FIX-4 — "Ruta con aprendizaje": un empleado reporta un atajo real
// que descubrió en campo. Un supervisor lo valida vía
// /api/admin/route-shortcuts/[id]/validate, que paga el bono de +$10.

// GET /api/employee/route-shortcuts — mis atajos reportados
export async function GET() {
  const supabase = createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const { data, error } = await supabase
    .from("route_shortcuts")
    .select("id, description, uses_count, reported_at, validated_at")
    .eq("employee_id", employee.id)
    .is("deleted_at", null)
    .order("reported_at", { ascending: false });

  if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

  return NextResponse.json({ shortcuts: data || [] }, { status: 200 });
}

// POST /api/employee/route-shortcuts — { description: string }
export async function POST(request: NextRequest) {
  const supabase = createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("route_shortcuts")
      .insert({ employee_id: employee.id, description })
      .select("id, description, uses_count, reported_at, validated_at")
      .single();

    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

    return NextResponse.json({ shortcut: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/wellbeing?date=YYYY-MM-DD — SOLO agregado, nunca individual.
// v8.3 E8: get_wellbeing_aggregate() es la unica funcion que puede leer
// daily_checkins; la tabla no tiene politica RLS de SELECT para admin.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("wellbeing", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  const { data, error } = await supabase.rpc("get_wellbeing_aggregate", { p_date: date });

  if (error) {
    console.error("admin/wellbeing error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ aggregate: data?.[0] || null }, { status: 200 });
}

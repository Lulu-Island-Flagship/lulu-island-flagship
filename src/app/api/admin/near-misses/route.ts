import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { weeklyPatternSummary, type NearMissRecord } from "@/lib/near-miss-patterns";

// GET /api/admin/near-misses?weekStart=YYYY-MM-DD — dashboard semanal con patrones (D.7.8).
// v8.3: "reporte sin penalización, anonimato opcional" — esta respuesta NUNCA incluye
// reported_by, a propósito: ni siquiera se selecciona esa columna de la base.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("near_misses", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const weekStartParam = searchParams.get("weekStart");

    // Lunes de esta semana en Vancouver si no se especifica.
    let weekStart = weekStartParam;
    if (!weekStart) {
      const vancouverDate = new Date().toLocaleString("en-CA", {
        timeZone: "America/Vancouver",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const today = new Date(vancouverDate.split(",")[0] + "T12:00:00-07:00");
      const monday = new Date(today);
      monday.setDate(today.getDate() - today.getDay() + 1);
      weekStart = monday.toISOString().split("T")[0];
    }
    const weekEnd = new Date(weekStart + "T00:00:00Z");
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndExclusive = weekEnd.toISOString().split("T")[0];

    // Deliberadamente NO seleccionamos reported_by ni is_anonymous con detalle de
    // identidad: el dashboard es agregado, no un listado de quién reportó qué.
    const { data, error } = await supabase
      .from("near_misses")
      .select("id, category, client_property_id, created_at")
      .is("deleted_at", null)
      .gte("created_at", weekStart)
      .lt("created_at", weekEndExclusive);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const records: NearMissRecord[] = (data || []).map((r) => ({
      id: r.id,
      category: r.category,
      clientPropertyId: r.client_property_id,
      createdAt: r.created_at,
    }));

    const patterns = weeklyPatternSummary(records, weekStart, weekEndExclusive);

    return NextResponse.json(
      { weekStart, weekEndExclusive, totalReports: records.length, patterns },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { formatAggregatedRows } from "@/lib/team-ranking";

// GET /api/admin/team-ranking?week_start=YYYY-MM-DD — Top 3 de EQUIPOS
// (B.2.21: solo equipos, solo Top 3, semanal). La única fuente es la RPC
// get_team_top3(), que ya agrega por equipo y ya trunca a 3 filas — esta
// ruta nunca hace SELECT directo a team_weekly_scores (evita cualquier
// tentación futura de "traer todo y truncar en el cliente").
// Resource "wellbeing": mismo bucket RBAC que otros agregados anónimos de
// E8 (owner_admin + ops_coordinator), no existe un recurso "team_ranking"
// dedicado en admin-rbac.ts y ese archivo está fuera de alcance de esta tanda.
function mostRecentMonday(d: Date): string {
  const day = d.getUTCDay(); // 0=domingo..6=sabado
  const diff = day === 0 ? 6 : day - 1; // días desde el lunes anterior
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diff);
  return monday.toISOString().split("T")[0];
}

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
  const weekStart = searchParams.get("week_start") || mostRecentMonday(new Date());

  const { data, error } = await supabase.rpc("get_team_top3", { p_week_start: weekStart });

  if (error) {
    console.error("admin/team-ranking error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const rows = (data || []).map((r: { team_id: string; team_name: string; composite_score: number }) => ({
    teamId: r.team_id,
    teamName: r.team_name,
    compositeScore: Number(r.composite_score),
  }));

  const top3 = formatAggregatedRows(rows);

  return NextResponse.json({ weekStart, top3 }, { status: 200 });
}

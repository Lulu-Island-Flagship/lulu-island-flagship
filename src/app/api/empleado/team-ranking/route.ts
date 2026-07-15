import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { formatAggregatedRows } from "@/lib/team-ranking";

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

function mostRecentMonday(d: Date): string {
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - diff);
  return monday.toISOString().split("T")[0];
}

/**
 * GET /api/empleado/team-ranking — v8.3 E8.10: "Ranking semanal anónimo...
 * visible en PWA." Existía la RPC get_team_top3 (SECURITY DEFINER, ya
 * trunca a 3 filas y solo agrega por equipo, B.2.21) y la usaba
 * /api/admin/team-ranking, pero ningún empleado podía verla -- la PWA
 * nunca tuvo esta ruta. Misma RPC, mismo truncado a 3, ahora también para
 * empleados autenticados (cualquier rol, no requiere admin).
 */
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  const weekStart = mostRecentMonday(new Date());

  const { data, error } = await supabase.rpc("get_team_top3", { p_week_start: weekStart });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data || []).map((r: { team_id: string; team_name: string; composite_score: number }) => ({
    teamId: r.team_id,
    teamName: r.team_name,
    compositeScore: Number(r.composite_score),
  }));

  const top3 = formatAggregatedRows(rows);

  return NextResponse.json({ weekStart, top3 }, { status: 200 });
}

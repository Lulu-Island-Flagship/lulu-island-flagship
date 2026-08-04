import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { formatAggregatedRows } from "@/lib/team-ranking";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { getVancouverTodayString } from "@/lib/date-utils";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
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
 * GET /api/employee/team-ranking — v8.3 E8.10: "Ranking semanal anónimo...
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

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  // Fix (auditoría timezone): mostRecentMonday opera en UTC -- se le pasa el
  // "hoy" de Vancouver anclado a mediodía UTC en vez de `new Date()` (que
  // usa el día calendario UTC del servidor, desfasado varias horas cada
  // tarde/noche de Vancouver).
  const weekStart = mostRecentMonday(new Date(`${getVancouverTodayString()}T12:00:00Z`));

  const { data, error } = await supabase.rpc("get_team_top3", { p_week_start: weekStart });
  if (error) {
    console.error("Supabase query error:", error);
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

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { evaluateCheckinStreakBonus, CHECKIN_STREAK_BONUS_CENTS } from "@/lib/wellbeing-bonus";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getVancouverTodayString } from "@/lib/date-utils";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

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

// GET /api/employee/checkin — mi checkin de hoy (si ya lo hice)
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
    id: string;
    wellbeing_opt_out: boolean | null;
  }>(supabase, user.id, "id, wellbeing_opt_out");
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  // v8.3 ROUND 4 fix (#11): "hoy" en UTC puede ser el día siguiente al de
  // Vancouver por las tardes/noches (Vancouver va detrás de UTC) -- se usa
  // la fecha calendario real de Vancouver.
  const today = getVancouverTodayString();
  const { data } = await supabase
    .from("daily_checkins")
    .select("checkin_date, slept_6h_plus, mood, shortcut_accepted")
    .eq("employee_id", employee.id)
    .eq("checkin_date", today)
    .single();

  // v8.3 E8 FIX-5: patrón individual de ánimo -- 3 días consecutivos de
  // "sad" -> sugerencia PRIVADA solo para este empleado, en su propia
  // respuesta HTTP. Esto NO rompe el anonimato del resto del sistema: se
  // computa leyendo únicamente las filas propias del empleado que hace la
  // request (la política RLS de daily_checkins ya solo permite eso), nunca
  // se persiste en una tabla legible por admin ni se agrega a
  // get_wellbeing_aggregate.
  let privateMoodSuggestion: string | null = null;
  const { data: recentMoods } = await supabase
    .from("daily_checkins")
    .select("checkin_date, mood")
    .eq("employee_id", employee.id)
    .order("checkin_date", { ascending: false })
    .limit(3);

  if (recentMoods && recentMoods.length === 3 && recentMoods.every((r) => r.mood === "sad")) {
    const dates = recentMoods.map((r) => Date.parse(`${r.checkin_date}T00:00:00Z`));
    const consecutive = dates[0] - dates[1] === 86400000 && dates[1] - dates[2] === 86400000;
    if (consecutive) {
      privateMoodSuggestion =
        "Notamos que marcaste \"Mal\" 3 días seguidos. Esto es solo visible para ti -- nadie más lo ve. Si quieres hablar con alguien o necesitas ajustar tu carga, puedes usar el modo \"No estoy listo\" o escribir a tu supervisor cuando quieras.";
    }
  }

  return NextResponse.json(
    { checkin: data || null, wellbeingOptOut: employee.wellbeing_opt_out === true, privateMoodSuggestion },
    { status: 200 }
  );
}

// POST /api/employee/checkin — checklist matutino (opcional, incentivado).
// v8.3 E8: NUNCA se lee individualmente por el admin — solo vía agregado.
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const { slept6hPlus, mood, shortcutAccepted } = body;

    if (mood && !["happy", "neutral", "sad"].includes(mood)) {
      return NextResponse.json({ error: "mood inválido" }, { status: 400 });
    }

    const today = getVancouverTodayString();
    const { data, error } = await supabase
      .from("daily_checkins")
      .upsert(
        {
          employee_id: employee.id,
          checkin_date: today,
          slept_6h_plus: slept6hPlus ?? null,
          mood: mood ?? null,
          shortcut_accepted: shortcutAccepted === true,
        },
        { onConflict: "employee_id,checkin_date" }
      )
      .select("checkin_date, slept_6h_plus, mood, shortcut_accepted")
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // v8.3 E8 FIX-3: racha de 5 días consecutivos de checklist -> +$5 real
    // (antes solo se prometía en el texto de la UI, sin backend). No
    // bloquea la respuesta del checkin si falla -- el checkin en sí ya se
    // guardó, el bono es un extra best-effort.
    let streakBonusAwarded = false;
    try {
      const { data: recentCheckins } = await supabase
        .from("daily_checkins")
        .select("checkin_date")
        .eq("employee_id", employee.id)
        .order("checkin_date", { ascending: false })
        .limit(10);

      const { data: existingBonuses } = await supabase
        .from("employee_wellbeing_bonuses")
        .select("credit_date")
        .eq("employee_id", employee.id)
        .eq("source", "checkin_streak_5day");

      const streak = evaluateCheckinStreakBonus(
        (recentCheckins || []).map((c) => c.checkin_date as string),
        today,
        (existingBonuses || []).map((b) => b.credit_date as string)
      );

      if (streak.eligible && streak.creditDate) {
        const { error: bonusError } = await supabase.from("employee_wellbeing_bonuses").insert({
          employee_id: employee.id,
          source: "checkin_streak_5day",
          bonus_cents: CHECKIN_STREAK_BONUS_CENTS,
          credit_date: streak.creditDate,
          notes: "5 días consecutivos de checklist matutino",
        });
        if (!bonusError) streakBonusAwarded = true;
      }
    } catch (bonusErr) {
      console.error("Streak bonus evaluation failed (non-blocking):", bonusErr);
    }

    return NextResponse.json({ checkin: data, streakBonusAwarded }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

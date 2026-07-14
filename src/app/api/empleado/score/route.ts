import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
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
    }
  );
}

// GET /api/empleado/score — score propio + historial + evaluaciones
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: me, error: meError } = await supabase
      .from("employees")
      .select("id, name, trust_level, career_level, career_level_since")
      .eq("user_id", user.id)
      .single();

    if (meError || !me) {
      return NextResponse.json({ error: "Employee not found" }, { status: 403 });
    }

    // Scores históricos
    const { data: scores, error: scoresError } = await supabase
      .from("employee_scores")
      .select("*")
      .eq("employee_id", me.id)
      .order("week_start", { ascending: false })
      .limit(10);

    if (scoresError) {
      console.error("Scores error:", scoresError);
    }

    // Evaluaciones de auditor
    const { data: audits, error: auditsError } = await supabase
      .from("field_audits")
      .select("*")
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (auditsError) {
      console.error("Audits error:", auditsError);
    }

    // Servicios recientes
    const { data: recentServices, error: servicesError } = await supabase
      .from("assignments")
      .select("order_id, status, created_at")
      .is("deleted_at", null)
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (servicesError) {
      console.error("Services error:", servicesError);
    }

    // v8.3 E8 (D.11): insignias ganadas + bono (si aplica)
    const { data: badges, error: badgesError } = await supabase
      .from("employee_badges")
      .select("id, badge_key, earned_at, evidence, employee_badge_bonuses(bonus_cents)")
      .eq("employee_id", me.id)
      .order("earned_at", { ascending: false });

    if (badgesError) {
      console.error("Badges error:", badgesError);
    }

    return NextResponse.json({
      employee: me,
      scores: scores || [],
      audits: audits || [],
      recentServices: recentServices || [],
      badges: badges || [],
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

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

// GET /api/cron/weekly-scores — recalcular scores semanales de todos los empleados
// Protegido por CRON_SECRET
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseClient();

    // Lunes de esta semana
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    const weekStart = monday.toISOString().split("T")[0];

    // Empleados activos
    const { data: employees, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("is_active", true);

    if (empError) {
      return NextResponse.json({ error: empError.message }, { status: 500 });
    }

    const results = [];

    for (const emp of employees || []) {
      // Llamar a la función RPC para recalcular
      const { data: scoreData, error: scoreError } = await supabase
        .rpc("recalculate_weekly_score", {
          p_employee_id: emp.id,
          p_week_start: weekStart,
        });

      if (scoreError) {
        console.error(`Score calc error for ${emp.id}:`, scoreError);
        continue;
      }

      const totalScore = scoreData?.[0]?.total_score || 0;
      const trustLevel = scoreData?.[0]?.trust_level || "standard";
      const telemetryScore = scoreData?.[0]?.telemetry_score || 0;
      const auditScore = scoreData?.[0]?.audit_score || 0;
      const peerScore = scoreData?.[0]?.peer_score || 0;
      const servicesCount = scoreData?.[0]?.services_count || 0;
      const disputesCount = scoreData?.[0]?.disputes_count || 0;

      // Upsert en employee_scores
      const { error: upsertError } = await supabase
        .from("employee_scores")
        .upsert({
          employee_id: emp.id,
          week_start: weekStart,
          total_score: totalScore,
          telemetry_score: telemetryScore,
          audit_score: auditScore,
          peer_score: peerScore,
          trust_level: trustLevel,
          services_count: servicesCount,
          disputes_count: disputesCount,
        }, { onConflict: "employee_id,week_start" });

      if (upsertError) {
        console.error(`Upsert error for ${emp.id}:`, upsertError);
      }

      // Actualizar trust_level en employees
      await supabase
        .from("employees")
        .update({ trust_level: trustLevel })
        .eq("id", emp.id);

      results.push({ employee_id: emp.id, total_score: totalScore, trust_level: trustLevel });
    }

    return NextResponse.json({
      week_start: weekStart,
      processed: results.length,
      results,
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

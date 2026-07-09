import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { evaluateReadinessRequest, detectAbusePattern, type ReadinessRequestType } from "@/lib/wellbeing";

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

function getQuarterRange(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + "T12:00:00Z");
  const quarter = Math.floor(d.getUTCMonth() / 3);
  const startMonth = quarter * 3;
  const start = new Date(Date.UTC(d.getUTCFullYear(), startMonth, 1)).toISOString().split("T")[0];
  const end = new Date(Date.UTC(d.getUTCFullYear(), startMonth + 3, 0)).toISOString().split("T")[0];
  return { start, end };
}

// POST /api/empleado/readiness — modo "No estoy listo" (v8.3 E8 D.8.6).
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  try {
    const body = await request.json();
    const { requestType, noticeHours } = body as { requestType: ReadinessRequestType; noticeHours: number };

    if (!["illness", "family_emergency", "no_transport"].includes(requestType)) {
      return NextResponse.json({ error: "requestType inválido" }, { status: 400 });
    }

    const today = new Date().toISOString().split("T")[0];
    const { start, end } = getQuarterRange(today);

    const { data: quarterRequests, error: qError } = await supabase
      .from("readiness_requests")
      .select("id, request_type, request_date")
      .eq("employee_id", employee.id)
      .gte("request_date", start)
      .lte("request_date", end)
      .is("deleted_at", null);

    if (qError) {
      return NextResponse.json({ error: qError.message }, { status: 500 });
    }

    const familyEmergenciesThisQuarter = (quarterRequests || []).filter(
      (r) => r.request_type === "family_emergency"
    ).length;

    const decision = evaluateReadinessRequest(requestType, noticeHours ?? 0, familyEmergenciesThisQuarter);

    const allDates = [...(quarterRequests || []).map((r) => r.request_date), today];
    const abuse = detectAbusePattern(allDates);

    const { data: created, error: insertError } = await supabase
      .from("readiness_requests")
      .insert({
        employee_id: employee.id,
        request_type: requestType,
        notice_hours: noticeHours ?? null,
        request_date: today,
        resolution: decision.fullDayRate ? "full_day_rate" : "pending",
        resolution_note: decision.reason,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        request: created,
        decision,
        abuseWarning: abuse.exceedsQuarterLimit || abuse.fridayMondayPattern ? abuse : null,
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

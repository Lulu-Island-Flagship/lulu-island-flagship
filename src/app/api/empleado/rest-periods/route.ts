import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";

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

/**
 * GET /api/empleado/rest-periods — el registro de descansos documentados
 * del propio empleado (últimos 30 días), para que pueda ver que sus
 * descansos de tránsito quedaron registrados. Ver honestidad en
 * src/lib/rest-documentation.ts: si su rol ese día fue 'driver', sus
 * tramos de tránsito NUNCA cuentan como descanso (sigue siendo trabajo).
 */
export async function GET(_request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);

  const { data: periods, error } = await supabase
    .from("employee_rest_periods")
    .select(
      "id, work_date, rest_start_at, rest_end_at, duration_minutes, role_during_rest, satisfies_esa_break, reason"
    )
    .eq("employee_id", employee.id)
    .gte("work_date", since.toISOString().slice(0, 10))
    .order("rest_start_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ periods: periods || [] }, { status: 200 });
}

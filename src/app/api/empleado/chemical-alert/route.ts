import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { shouldTriggerChemicalWellbeingAlert } from "@/lib/wellbeing";
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

// POST /api/empleado/chemical-alert — v8.3 E8 regla dura: mal estado + tarea
// de riesgo quimico hoy => crea la alerta que el cron de reasignacion vigila.
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const { mood, slept6hPlus, hasChemicalRiskTaskToday, assignmentId } = body;

    const trigger = shouldTriggerChemicalWellbeingAlert(mood ?? null, slept6hPlus ?? null, hasChemicalRiskTaskToday === true);
    if (!trigger) {
      return NextResponse.json({ alertCreated: false }, { status: 200 });
    }

    const { data, error } = await supabase
      .from("wellbeing_chemical_alerts")
      .insert({
        employee_id: employee.id,
        assignment_id: assignmentId || null,
        resolution: "pending",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ alertCreated: true, alert: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

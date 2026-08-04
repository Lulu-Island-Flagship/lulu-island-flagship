import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { shouldTriggerChemicalWellbeingAlert } from "@/lib/wellbeing";
import { requireActiveEmployee } from "@/lib/require-active-employee";
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

// POST /api/employee/chemical-alert — v8.3 E8 regla dura: mal estado + tarea
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

    // Verify assignment ownership if assignmentId is provided (IDOR fix)
    if (assignmentId != null) {
      const { data: assignmentData, error: assignmentError } = await supabase
        .from("assignments")
        .select("id")
        .is("deleted_at", null)
        .eq("id", assignmentId)
        .eq("employee_id", employee.id)
        .maybeSingle();

      if (assignmentError) {
        console.error("Assignment verification error:", assignmentError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      if (!assignmentData) {
        return NextResponse.json({ error: "Assignment does not belong to you" }, { status: 403 });
      }
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
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ alertCreated: true, alert: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

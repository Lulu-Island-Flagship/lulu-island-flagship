import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { calculatePayroll, BC_MIN_WAGE_HOURLY } from "@/lib/payroll";
import { decideSickLeaveEligibility } from "@/lib/sick-leave";

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
 * GET/POST /api/empleado/sick-leave — v8.3 (BC ESA Parte 5.1).
 *
 * POST: el empleado reporta una ausencia por enfermedad, con excusa
 * simple en texto ("tengo gripa") O con documentPath de una nota médica
 * ya subida al bucket privado 'sick-notes' -- ninguna vía es obligatoria
 * sobre la otra. El servidor calcula días empleados (hire_date) y cuenta
 * los días pagados/no-pagados-protegidos ya usados ESTE año calendario
 * para decidir pay_type via src/lib/sick-leave.ts. Si pay_type='paid', el
 * monto pagado es el Day Rate del empleado (mismo modelo que el resto de
 * la nómina) -- no un promedio distinto.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase
    .from("employees")
    .select("id, hire_date, day_rate")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "No employee record found" }, { status: 404 });

  try {
    const body = await request.json();
    const { absenceDate, reasonType, reasonText, documentPath } = body as {
      absenceDate?: string;
      reasonType?: string;
      reasonText?: string;
      documentPath?: string;
    };

    if (!absenceDate || Number.isNaN(new Date(absenceDate).getTime())) {
      return NextResponse.json({ error: "absenceDate is required" }, { status: 400 });
    }
    if (!["self_reported", "medical_note"].includes(reasonType || "")) {
      return NextResponse.json({ error: "reasonType must be self_reported or medical_note" }, { status: 400 });
    }
    if (!reasonText || reasonText.trim().length === 0) {
      return NextResponse.json(
        { error: "reasonText is required — a short reason like 'tengo gripa' is enough" },
        { status: 400 }
      );
    }
    if (reasonType === "medical_note" && !documentPath) {
      return NextResponse.json(
        { error: "documentPath is required when reasonType is medical_note" },
        { status: 400 }
      );
    }

    const daysEmployedContinuous = employee.hire_date
      ? Math.floor((new Date(absenceDate).getTime() - new Date(employee.hire_date).getTime()) / 86400000)
      : 0;

    const yearStart = `${new Date(absenceDate).getUTCFullYear()}-01-01`;
    const yearEnd = `${new Date(absenceDate).getUTCFullYear()}-12-31`;
    const { data: priorRequests } = await supabase
      .from("sick_leave_requests")
      .select("pay_type")
      .eq("employee_id", employee.id)
      .gte("absence_date", yearStart)
      .lte("absence_date", yearEnd);

    const paidDaysUsedThisYear = (priorRequests || []).filter((r) => r.pay_type === "paid").length;
    const unpaidProtectedDaysUsedThisYear = (priorRequests || []).filter(
      (r) => r.pay_type === "unpaid_protected"
    ).length;

    const eligibility = decideSickLeaveEligibility({
      daysEmployedContinuous: Math.max(0, daysEmployedContinuous),
      paidDaysUsedThisYear,
      unpaidProtectedDaysUsedThisYear,
    });

    const paidAmountCents =
      eligibility.payType === "paid" ? calculatePayroll({ dayRate: employee.day_rate }).baseAmount : null;

    const { data: created, error } = await supabase
      .from("sick_leave_requests")
      .insert({
        employee_id: employee.id,
        absence_date: absenceDate,
        reason_type: reasonType,
        reason_text: reasonText.trim(),
        document_path: documentPath || null,
        days_employed_at_request: Math.max(0, daysEmployedContinuous),
        pay_type: eligibility.payType,
        eligibility_reason: eligibility.reason,
        paid_amount_cents: paidAmountCents,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "Already reported an absence for this date" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ request: created, minWageHourlyReference: BC_MIN_WAGE_HOURLY }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET: historial propio del empleado, este año calendario. */
export async function GET() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "No employee record found" }, { status: 404 });

  const currentYear = new Date().getUTCFullYear();
  const { data: requests, error } = await supabase
    .from("sick_leave_requests")
    .select("id, absence_date, reason_type, reason_text, pay_type, eligibility_reason, paid_amount_cents, created_at")
    .eq("employee_id", employee.id)
    .gte("absence_date", `${currentYear}-01-01`)
    .order("absence_date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ requests: requests || [] }, { status: 200 });
}

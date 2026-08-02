import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { calculatePayroll, BC_MIN_WAGE_HOURLY } from "@/lib/payroll";
import { decideSickLeaveEligibility } from "@/lib/sick-leave";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

// v8.3 auditoría 2026-07-21 (D-P0-2, migración 213): la escritura real de
// pay_type='paid'/paid_amount_cents ahora requiere service-role -- la RLS
// de la anon key solo permite insertar en estado no pagable. La decisión
// de negocio (decideSickLeaveEligibility) sigue siendo del servidor; lo
// que cambia es que el resultado se persiste con una credencial que RLS
// no puede recortar.
function getServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(getSupabaseUrl(), serviceKey);
}

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
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

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
    id: string;
    hire_date: string | null;
    day_rate: number | null;
  }>(supabase, user.id, "id, hire_date, day_rate");
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

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

    // Fix (auditoría 2026-07-31, #14): antes se aceptaba cualquier string
    // como documentPath sin validar que perteneciera a este empleado ni que
    // fuera un archivo real subido al bucket privado 'sick-notes' -- un
    // empleado podía enviar el path de la nota médica de OTRO empleado (o
    // cualquier string arbitrario) directo por API, sin pasar por la UI de
    // subida. Se valida: (1) el path debe empezar con "<employee.id>/" --
    // mismo prefijo que usa la UI al subir (ver enfermedad/page.tsx), (2)
    // extensión permitida, (3) el archivo debe existir realmente en el
    // bucket con un tamaño razonable (verificado vía service-role, la anon
    // key no tiene acceso de lectura a metadata de otros archivos del
    // bucket privado).
    const ALLOWED_DOCUMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"];
    const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    if (documentPath) {
      if (!documentPath.startsWith(`${employee.id}/`) || documentPath.includes("..")) {
        return NextResponse.json(
          { error: "documentPath is invalid for this employee" },
          { status: 403 }
        );
      }
      const ext = documentPath.split(".").pop()?.toLowerCase() || "";
      if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(ext)) {
        return NextResponse.json(
          { error: `documentPath must have one of these extensions: ${ALLOWED_DOCUMENT_EXTENSIONS.join(", ")}` },
          { status: 400 }
        );
      }

      const svcForCheck = getServiceClient();
      if (!svcForCheck) {
        return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
      }
      const folder = documentPath.split("/").slice(0, -1).join("/");
      const fileName = documentPath.split("/").pop() || "";
      const { data: listing, error: listError } = await svcForCheck.storage
        .from("sick-notes")
        .list(folder, { search: fileName });
      const uploadedFile = listing?.find((f) => f.name === fileName);
      if (listError || !uploadedFile) {
        return NextResponse.json(
          { error: "documentPath does not correspond to an uploaded file" },
          { status: 400 }
        );
      }
      const sizeBytes = (uploadedFile.metadata as { size?: number } | null)?.size ?? 0;
      if (sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
        return NextResponse.json(
          { error: "The medical note file is too large (max 10MB)" },
          { status: 400 }
        );
      }
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

    // v8.3 auditoría 2026-07-21 (D-P0-1): day_rate está en DÓLARES
    // (employees.day_rate) pero calculatePayroll espera CENTAVOS
    // ("// cents CAD", payroll.ts:18) -- pasar el valor crudo pagaba
    // $2.00 en vez de $200.00. Se convierte con dollarsToCents antes de
    // llamar, y se usa .grossAmount (no .baseAmount) para respetar el
    // ajuste al piso salarial mínimo de BC que calculatePayroll ya
    // calcula pero que .baseAmount ignora.
    if (eligibility.payType === "paid" && employee.day_rate == null) {
      return NextResponse.json(
        { error: "Employee day rate is not configured" },
        { status: 500 }
      );
    }

    const paidAmountCents =
      eligibility.payType === "paid" && employee.day_rate != null
        ? calculatePayroll({ dayRate: Math.round(employee.day_rate * 100) }).grossAmount
        : null;

    // v8.3 (D-P0-2, migración 213): con la RLS restringida, un INSERT con
    // pay_type='paid'/paid_amount_cents no-null ya no pasa por la anon
    // key. Se escribe con service-role -- la decisión de negocio ya se
    // tomó server-side arriba (decideSickLeaveEligibility), esto solo
    // persiste el resultado sin que RLS lo pueda recortar ni un tercero
    // lo pueda forjar directamente contra la tabla.
    const serviceClient = getServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
    }

    const { data: created, error } = await serviceClient
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
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ request: created, minWageHourlyReference: BC_MIN_WAGE_HOURLY }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

/** GET: historial propio del empleado, este año calendario. */
export async function GET() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const currentYear = new Date().getUTCFullYear();
  const { data: requests, error } = await supabase
    .from("sick_leave_requests")
    .select("id, absence_date, reason_type, reason_text, pay_type, eligibility_reason, paid_amount_cents, created_at")
    .eq("employee_id", employee.id)
    .gte("absence_date", `${currentYear}-01-01`)
    .order("absence_date", { ascending: false });

  if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

  return NextResponse.json({ requests: requests || [] }, { status: 200 });
}

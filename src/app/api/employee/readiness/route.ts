import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { evaluateReadinessRequest, detectAbusePattern, type ReadinessRequestType } from "@/lib/wellbeing";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getVancouverTodayString } from "@/lib/date-utils";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

// v8.3 auditoría 2026-07-21 (D-P0-3, migración 213): con la RLS
// restringida, readiness_requests solo se puede insertar como
// resolution='pending' con la anon key, y payroll_readiness_credits ya no
// admite INSERT de empleado en absoluto. La resolución real y el crédito
// de nómina se escriben con service-role, después de aplicar aquí mismo
// la unicidad diaria y el límite de abuso.
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
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
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

// POST /api/employee/readiness — modo "No estoy listo" (v8.3 E8 D.8.6).
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const { requestType, noticeHours } = body as { requestType: ReadinessRequestType; noticeHours: number };

    if (!["illness", "family_emergency", "no_transport"].includes(requestType)) {
      return NextResponse.json({ error: "requestType inválido" }, { status: 400 });
    }

    const today = getVancouverTodayString();
    const { start, end } = getQuarterRange(today);

    const serviceClient = getServiceClient();
    if (!serviceClient) {
      return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
    }

    // v8.3 auditoría 2026-07-21 (D-P0-3): unicidad diaria -- antes nada
    // impedía que el mismo empleado creara varias solicitudes de
    // readiness el mismo día (cada una potencialmente pagable). Un solo
    // "no estoy listo" por día calendario.
    const { data: todaysRequest, error: todaysError } = await supabase
      .from("readiness_requests")
      .select("id")
      .eq("employee_id", employee.id)
      .eq("request_date", today)
      .is("deleted_at", null)
      .maybeSingle();

    if (todaysError) {
      console.error("todaysError:", todaysError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (todaysRequest) {
      return NextResponse.json(
        { error: "Ya existe una solicitud de 'no estoy listo' registrada hoy." },
        { status: 409 }
      );
    }

    const { data: quarterRequests, error: qError } = await supabase
      .from("readiness_requests")
      .select("id, request_type, request_date")
      .eq("employee_id", employee.id)
      .gte("request_date", start)
      .lte("request_date", end)
      .is("deleted_at", null);

    if (qError) {
      console.error("qError:", qError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const familyEmergenciesThisQuarter = (quarterRequests || []).filter(
      (r) => r.request_type === "family_emergency"
    ).length;

    let decision = evaluateReadinessRequest(requestType, noticeHours ?? 0, familyEmergenciesThisQuarter);

    const allDates = [...(quarterRequests || []).map((r) => r.request_date), today];
    const abuse = detectAbusePattern(allDates);

    // v8.3 auditoría 2026-07-21 (D-P0-3): detectAbusePattern antes se
    // calculaba y se devolvía en el JSON de respuesta sin ningún efecto
    // real. Ahora sí bloquea el Day Rate completo cuando se excede el
    // límite trimestral (defensa adicional a la que ya hace
    // evaluateReadinessRequest para family_emergency, cubre el caso
    // combinado illness+family_emergency+no_transport), y persiste una
    // alerta para que un admin lo revise -- en ambos casos (exceso de
    // cupo o patrón viernes/lunes), no solo en la respuesta HTTP.
    if (abuse.exceedsQuarterLimit && decision.fullDayRate) {
      decision = {
        fullDayRate: false,
        reason: `Bloqueado: ya se superó el límite de ${allDates.length - 1} solicitudes este trimestre. Requiere revisión de un administrador.`,
      };
    }

    if (abuse.exceedsQuarterLimit || abuse.fridayMondayPattern) {
      const { error: alertError } = await serviceClient.from("unified_alerts").insert({
        source_module: "readiness_abuse_pattern",
        source_table: "readiness_requests",
        source_id: employee.id,
        tier: "can_wait",
        severity: "p2_automatic",
        title: abuse.exceedsQuarterLimit
          ? "Empleado excede el límite trimestral de solicitudes 'no estoy listo'"
          : "Patrón viernes/lunes en solicitudes 'no estoy listo'",
        summary: `Empleado ${employee.id}: ${allDates.length} solicitudes este trimestre. exceedsQuarterLimit=${abuse.exceedsQuarterLimit}, fridayMondayPattern=${abuse.fridayMondayPattern}.`,
      });
      if (alertError) {
        console.error("Readiness abuse alert insert error:", alertError);
      }
    }

    // Escritura confiable (service-role): la anon key solo puede insertar
    // resolution='pending' (RLS, migración 213). Aquí se persiste la
    // resolución real ya decidida arriba.
    const { data: created, error: insertError } = await serviceClient
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
      console.error("insertError:", insertError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // v8.3 E9: conectar la resolución full_day_rate a la nómina real. El
    // monto (day_rate_cents) lo calcula el trigger set_readiness_credit_day_rate
    // desde employees.day_rate vigente — nunca se envía desde aquí. El
    // INSERT ya no es alcanzable por el empleado vía anon key (migración
    // 213) -- solo service-role o un supervisor pueden crear esta fila.
    let payrollCreditError: string | null = null;
    if (decision.fullDayRate) {
      const { error: creditError } = await serviceClient.from("payroll_readiness_credits").insert({
        readiness_request_id: created.id,
        employee_id: employee.id,
        credit_date: today,
        day_rate_cents: 1, // placeholder; el trigger BEFORE INSERT lo sobrescribe siempre
        reason: decision.reason,
      });
      if (creditError) {
        console.error("Readiness payroll credit insert error:", creditError);
        payrollCreditError =
          "El Day Rate se aprobó pero no se pudo registrar el crédito de nómina automáticamente. Contactar a administración.";
      }
    }

    return NextResponse.json(
      {
        request: created,
        decision,
        abuseWarning: abuse.exceedsQuarterLimit || abuse.fridayMondayPattern ? abuse : null,
        payrollCreditError,
      },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

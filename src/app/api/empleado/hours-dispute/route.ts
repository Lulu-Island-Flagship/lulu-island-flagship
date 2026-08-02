import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * v8.3 FIX-9 (D.3 #7 / D.11 sec. #517-518): "Disputa de T: el empleado marca
 * 'T incorrecto' con prueba, admin resuelve en 24h; falla técnica nunca
 * penaliza."
 *
 * Antes de este endpoint no existía NINGÚN canal para que un empleado
 * disputara las horas (T_in/T_out) que quedaron registradas para un
 * servicio -- solo existía /api/empleado/appeal, y ese es exclusivamente
 * para apelar el SCORE de una auditoría de campo (field_audits), un dominio
 * distinto (calidad, no horas/nómina). El plan los describe como canales
 * separados ("mismo mecanismo que disputa de T" en la sección de apelación
 * QC implica que la disputa de T es la referencia, no un duplicado de ella).
 *
 * Usa tickets_disputas (type='hours_dispute', migración 176) siguiendo el
 * mismo patrón que dispatch-scheduler/discrepancy y upsells/upsell_approval
 * -- sin inventar una tabla paralela. La ventana de 24h para que el admin
 * resuelva es un compromiso operativo (SLA), no algo que este endpoint
 * pueda hacer cumplir por sí mismo; queda documentado en el contexto del
 * ticket para que el panel admin lo muestre y lo priorice.
 */

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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

// POST /api/empleado/hours-dispute
// Body: { orderId, claimedEventType: "t_in"|"t_start"|"t_out"|"jornada_start"|"jornada_end",
//         claimedTimestamp: ISO string, reason: string, evidenceNote?: string }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, claimedEventType, claimedTimestamp, reason, evidenceNote } = body;

    if (!orderId || !claimedEventType || !claimedTimestamp || !reason || !reason.trim()) {
      return NextResponse.json(
        { error: "Missing required fields: orderId, claimedEventType, claimedTimestamp, reason" },
        { status: 400 }
      );
    }

    const validEventTypes = ["jornada_start", "jornada_end", "t_in", "t_start", "t_out"];
    if (!validEventTypes.includes(claimedEventType)) {
      return NextResponse.json({ error: "Invalid claimedEventType" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Verificar que el empleado tuvo asignación real en este order -- mismo
    // guard que /api/empleado/upsells, evita que alguien dispute horas de un
    // servicio ajeno.
    const { data: assignment } = await supabase
      .from("assignments")
      .select("id")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (!assignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // Traer el registro de service_logs actual para ese evento (lo que el
    // sistema tiene registrado hoy), para que el admin compare contra lo que
    // el empleado reclama sin tener que ir a buscarlo aparte.
    const { data: currentLogs } = await supabase
      .from("service_logs")
      .select("id, event_type, timestamp")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .eq("event_type", claimedEventType)
      .order("timestamp", { ascending: false })
      .limit(1);

    const recordedTimestamp = currentLogs?.[0]?.timestamp ?? null;

    // Evitar duplicados: una disputa abierta ya existente para el mismo
    // order+evento no debe generar un segundo ticket.
    const { data: existingTicket } = await supabase
      .from("tickets_disputas")
      .select("id")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .eq("type", "hours_dispute")
      .in("status", ["open", "in_review"])
      .contains("context", { claimed_event_type: claimedEventType })
      .maybeSingle();

    if (existingTicket) {
      return NextResponse.json(
        { error: "You already have an open dispute for this event on this service" },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: ticket, error } = await supabase
      .from("tickets_disputas")
      .insert({
        order_id: orderId,
        employee_id: employee.id,
        type: "hours_dispute",
        priority: "high",
        status: "open",
        context: {
          order_id: orderId,
          employee_id: employee.id,
          claimed_event_type: claimedEventType,
          claimed_timestamp: claimedTimestamp,
          recorded_timestamp: recordedTimestamp,
          reason: reason.trim(),
          evidence_note: evidenceNote?.trim() || null,
          reported_at: nowIso,
          // SLA documentado en D.3: 24h para resolución del admin.
          sla_due_at: new Date(new Date(nowIso).getTime() + 24 * 60 * 60 * 1000).toISOString(),
          source: "hours_dispute",
        },
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ success: true, ticket }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// GET /api/empleado/hours-dispute?orderId=... — historial propio de disputas de T
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    let query = supabase
      .from("tickets_disputas")
      .select("*")
      .eq("employee_id", employee.id)
      .eq("type", "hours_dispute")
      .order("created_at", { ascending: false });

    if (orderId) {
      query = query.eq("order_id", orderId);
    }

    const { data: tickets, error } = await query;

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ tickets: tickets || [] }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

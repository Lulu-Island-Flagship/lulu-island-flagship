import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/audits — servicios completados pendientes de auditoría + historial de evaluaciones
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("field_audits", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get("employeeId");
    const weekStart = searchParams.get("weekStart");

    // Servicios completados sin auditoría (solo de hoy en Vancouver)
    const vancouverDate = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver" });
    const today = vancouverDate.split(",")[0];

    // Primero obtener los order_id ya auditados
    const { data: auditedOrders, error: auditedError } = await supabase
      .from("field_audits")
      .select("order_id");

    if (auditedError) {
      console.error("Audited orders fetch error:", auditedError);
      return NextResponse.json({ error: "Failed to fetch audited orders" }, { status: 500 });
    }

    const auditedIds = (auditedOrders || []).map((a: { order_id: string }) => a.order_id);

    let pendingQuery = supabase
      .from("orders")
      .select(`
        id,
        service_date,
        service_time,
        status,
        quote_id,
        quotes:quote_id (address, service_type),
        assignments!inner(employee_id, status)
      `)
      .eq("status", "completed")
      .eq("service_date", today)
      .order("service_date", { ascending: false })
      .limit(50);

    if (auditedIds.length > 0) {
      pendingQuery = pendingQuery.not("id", "in", auditedIds);
    }

    const { data: pendingOrders, error: pendingError } = await pendingQuery;

    if (pendingError) {
      console.error("Pending audits error:", pendingError);
    }

    // Evaluaciones existentes
    let auditsQuery = supabase
      .from("field_audits")
      .select(`
        id,
        order_id,
        employee_id,
        score,
        criteria,
        notes,
        created_at,
        appealed_at,
        appeal_reason,
        appeal_resolved_at,
        employees:employee_id (name)
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (employeeId) {
      auditsQuery = auditsQuery.eq("employee_id", employeeId);
    }

    const { data: audits, error: auditsError } = await auditsQuery;

    if (auditsError) {
      console.error("Audits fetch error:", auditsError);
    }

    // Votaciones agregadas de la semana actual + nombres de empleados
    const monday = weekStart || today;
    const { data: peerVotes, error: votesError } = await supabase
      .from("peer_votes")
      .select("target_employee_id, rating")
      .eq("week_start", monday);

    if (votesError) {
      console.error("Peer votes error:", votesError);
    }

    // Obtener nombres de empleados para las votaciones
    const targetIds = Array.from(new Set((peerVotes || []).map((v: { target_employee_id: string }) => v.target_employee_id)));
    const { data: peerEmployees, error: peerEmpError } = targetIds.length > 0
      ? await supabase
          .from("employees")
          .select("id, name")
          .in("id", targetIds)
      : { data: [], error: null };

    if (peerEmpError) {
      console.error("Peer employees error:", peerEmpError);
    }

    const employeeNameMap = new Map((peerEmployees || []).map((e) => [e.id, e.name]));

    const voteMap = new Map<string, { count: number; avg: number; name: string }>();
    for (const v of peerVotes || []) {
      const existing = voteMap.get(v.target_employee_id);
      if (existing) {
        existing.count += 1;
        existing.avg = (existing.avg * (existing.count - 1) + v.rating) / existing.count;
      } else {
        voteMap.set(v.target_employee_id, {
          count: 1,
          avg: v.rating,
          name: employeeNameMap.get(v.target_employee_id) || "Unknown",
        });
      }
    }

    return NextResponse.json({
      pendingOrders: pendingOrders || [],
      audits: audits || [],
      peerVoteAggregates: Object.fromEntries(voteMap),
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/audits — registrar evaluación de auditor de campo
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("field_audits", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { orderId, employeeId, score, criteria, notes, photoUrl, announceToClient } = body;

    if (!orderId || !employeeId || score === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Reuse the already-authenticated user from requireSupervisor
    const { data: auditor } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!auditor?.id) {
      return NextResponse.json({ error: "Auditor not found in employees table" }, { status: 403 });
    }

    // Calcular probabilidad de re-despacho basada en score y criterios
    const criteriaValues = Object.values((criteria as Record<string, unknown>) || {})
      .map((v) => Number(v))
      .filter((n) => !isNaN(n));
    const avgCriteria = criteriaValues.length > 0
      ? criteriaValues.reduce((a, b) => a + b, 0) / criteriaValues.length
      : 3;
    const dispatchProbability = Math.max(0, Math.min(1, Number((score / 100) * (avgCriteria / 5))));
    const shouldAnnounce = announceToClient === true || dispatchProbability >= 0.8;

    const { data, error } = await supabase
      .from("field_audits")
      .insert({
        order_id: orderId,
        employee_id: employeeId,
        auditor_id: auditor.id,
        score,
        criteria: criteria || {},
        notes: notes || null,
        photo_url: photoUrl || null,
        dispatch_probability: dispatchProbability,
        client_announced: shouldAnnounce,
        client_announced_at: shouldAnnounce ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      audit: data,
      dispatchProbability,
      clientAnnounced: shouldAnnounce,
    }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

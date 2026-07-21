import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { isAuditSampleSelected, getMandatoryAuditTriggers } from "@/lib/field-audit-sampling";
import { NEW_CLIENT_MAX_SERVICES } from "@/lib/client-segmentation";

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
        user_id,
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
      // postgrest-js interpola el 3er argumento de .not() directamente en el
      // querystring sin serializar arrays: hay que pasar el string ya
      // envuelto en paréntesis como exige PostgREST para "in".
      pendingQuery = pendingQuery.not("id", "in", `(${auditedIds.join(",")})`);
    }

    const { data: pendingOrders, error: pendingError } = await pendingQuery;

    if (pendingError) {
      console.error("Pending audits error:", pendingError);
    }

    // v8.3 E3 fix: triggers obligatorios además del muestreo aleatorio ~20%.
    // El muestreo aleatorio por sí solo puede dejar pasar días sin auditar a
    // un cliente nuevo, una cuadrilla con score bajo, un empleado en zona
    // roja o una orden que ya generó una disputa -- señales que no deberían
    // depender de a qué lado del hash cayó la orden ese día.
    type PendingOrderRow = {
      id: string;
      user_id: string;
      assignments: { employee_id: string; status: string }[];
    };
    const pendingOrdersRows = (pendingOrders || []) as unknown as PendingOrderRow[];

    const employeeIds = Array.from(
      new Set(pendingOrdersRows.flatMap((o) => (o.assignments || []).map((a) => a.employee_id)))
    );
    const clientUserIds = Array.from(new Set(pendingOrdersRows.map((o) => o.user_id).filter(Boolean)));
    const pendingOrderIds = pendingOrdersRows.map((o) => o.id);

    // Score más reciente por empleado (employee_scores.total_score, 0-100).
    const employeeScoreMap = new Map<string, number>();
    if (employeeIds.length > 0) {
      const { data: scoreRows, error: scoreError } = await supabase
        .from("employee_scores")
        .select("employee_id, total_score, week_start")
        .in("employee_id", employeeIds)
        .order("week_start", { ascending: false });
      if (scoreError) {
        console.error("Employee scores fetch error:", scoreError);
      }
      for (const row of scoreRows || []) {
        if (!employeeScoreMap.has(row.employee_id)) {
          employeeScoreMap.set(row.employee_id, row.total_score);
        }
      }
    }

    // Cantidad de servicios completados históricos por cliente (para detectar "nuevo").
    const clientServiceCountMap = new Map<string, number>();
    if (clientUserIds.length > 0) {
      const { data: clientOrders, error: clientOrdersError } = await supabase
        .from("orders")
        .select("user_id")
        .in("user_id", clientUserIds)
        .eq("status", "completed");
      if (clientOrdersError) {
        console.error("Client order history fetch error:", clientOrdersError);
      }
      for (const row of clientOrders || []) {
        clientServiceCountMap.set(row.user_id, (clientServiceCountMap.get(row.user_id) || 0) + 1);
      }
    }

    // Disputas asociadas a estas órdenes (post-disputa = trigger obligatorio).
    const disputedOrderIds = new Set<string>();
    if (pendingOrderIds.length > 0) {
      const { data: disputeRows, error: disputeError } = await supabase
        .from("tickets_disputas")
        .select("order_id")
        .in("order_id", pendingOrderIds)
        .eq("type", "dispute");
      if (disputeError) {
        console.error("Disputes fetch error:", disputeError);
      }
      for (const row of disputeRows || []) {
        if (row.order_id) disputedOrderIds.add(row.order_id);
      }
    }

    // v8.3 E5: muestreo aleatorio ~20% (determinístico por dia) — no reemplaza
    // la eleccion manual del auditor, solo marca una muestra objetiva sugerida
    // para que la auditoria de campo no dependa solo de lo que "parece sospechoso".
    const pendingOrdersWithSample = pendingOrdersRows.map((o) => {
      const crewScores = (o.assignments || [])
        .map((a) => employeeScoreMap.get(a.employee_id))
        .filter((s): s is number => typeof s === "number");
      const teamScore = crewScores.length > 0
        ? crewScores.reduce((a, b) => a + b, 0) / crewScores.length
        : null;
      const employeeScore = crewScores.length > 0 ? Math.min(...crewScores) : null;
      const isNewClient = (clientServiceCountMap.get(o.user_id) || 0) <= NEW_CLIENT_MAX_SERVICES;
      const hasRecentDispute = disputedOrderIds.has(o.id);

      const mandatoryReasons = getMandatoryAuditTriggers({
        isNewClient,
        teamScore,
        employeeScore,
        hasRecentDispute,
      });

      return {
        ...o,
        suggestedForAudit: isAuditSampleSelected(o.id, today) || mandatoryReasons.length > 0,
        mandatoryAudit: mandatoryReasons.length > 0,
        mandatoryReasons,
      };
    });

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
      pendingOrders: pendingOrdersWithSample,
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

    // v8.3 E3 fix: validar rango 1-5 en servidor (coincide con field_audits.score
    // CHECK BETWEEN 1 AND 5) en vez de dejar que la base de datos rechace con un
    // 500 genérico cuando el cliente envía un valor fuera de rango.
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: "score must be an integer between 1 and 5" }, { status: 400 });
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
    // v8.3 E3 fix: score llega en escala 1-5 (igual que field_audits.score,
    // CHECK BETWEEN 1 AND 5) -- este cálculo asumía 0-100 y siempre producía
    // una probabilidad casi nula. Coherente ahora con el slider del cliente
    // (admin/audits/page.tsx) y con la RPC compute_trust_score.
    const dispatchProbability = Math.max(0, Math.min(1, Number((score / 5) * (avgCriteria / 5))));
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

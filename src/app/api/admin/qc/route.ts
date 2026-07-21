import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { isQcSampleSelected } from "@/lib/anti-gaming";
import { getVancouverTodayString } from "@/lib/date-utils";

// GET /api/admin/qc — grid de servicios para QC review
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || "50"), 1), 200);

    const { data, error } = await supabase
      .from("qc_reviews")
      .select(`
        id,
        order_id,
        employee_id,
        status,
        note,
        reviewed_at,
        created_at,
        orders:order_id (service_date, service_time),
        employees:employee_id (name, trust_level)
      `)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ reviews: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/qc — crear QC review (auto-aprobar élite con muestreo)
//
// v8.3 fix (migración 231, auditoría 2026-07-21, A-6): esta ruta corría en
// carrera contra trigger_create_qc_review_on_complete() (AFTER UPDATE ON
// orders, misma transacción que pone la orden en 'completed') y SIEMPRE
// perdía -- el trigger insertaba primero con ON CONFLICT (order_id) DO
// NOTHING, así que el INSERT de aquí abajo nunca se ejecutaba en la práctica
// para el flujo normal de cierre de servicio. La migración 231 portó el
// muestreo del 10% (isQcSampleSelected) DENTRO del trigger para que sea la
// única fuente de verdad de qc_reviews en el camino normal.
//
// Esta ruta queda como creación manual/directa de una qc_review (p.ej. para
// re-encolar una revisión fuera del flujo de completar orden) y ya NO debe
// competir por el INSERT: reutiliza la misma lógica de muestreo por si se
// invoca antes de que el trigger corra, pero usa upsert con
// ignoreDuplicates para ceder ante lo que el trigger ya haya insertado en
// vez de fallar o duplicar.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("qc_wall", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { orderId, employeeId } = body;

    if (!orderId || !employeeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // v8.3 E5.2 — anti-gaming habilitado (src/lib/anti-gaming.ts, migración
    // 153). auto_approval_revoked_at no-null FUERZA muro QC completo sin
    // importar trust_level -- es la consecuencia de una manipulación
    // detectada previamente y solo un admin la revierte explícitamente
    // (no hay ruta automática que la limpie).
    const { data: employee } = await supabase
      .from("employees")
      .select("trust_level, auto_approval_revoked_at")
      .eq("id", employeeId)
      .single();

    const isElite = employee?.trust_level === "elite" && !employee?.auto_approval_revoked_at;
    const isSampled = isElite && isQcSampleSelected(orderId, getVancouverTodayString());

    let reviewStatus = "pending";
    // Literal alineado con trigger_create_qc_review_on_complete() (migración
    // 231): ambos caminos deben producir el mismo sampling_reason para el
    // mismo caso, o admin/qc/[orderId]/review/route.ts leería valores
    // distintos según quién ganó la carrera.
    let samplingReason: string | null = null;

    if (isElite && !isSampled) {
      reviewStatus = "auto";
      samplingReason = "Elite auto-approval";
    } else if (isElite && isSampled) {
      // Habría sido auto-aprobado, pero cayó en el 10% que igual pasa por
      // revisión humana (ver evaluateSampledRejectionRate en el resolve).
      samplingReason = "elite_auto_approval_sample";
    }

    // upsert + ignoreDuplicates: si el trigger de la orden ya insertó esta
    // fila (order_id UNIQUE), no fallamos ni duplicamos -- devolvemos la
    // fila existente, que es la fuente de verdad.
    const { error: upsertError } = await supabase
      .from("qc_reviews")
      .upsert(
        {
          order_id: orderId,
          employee_id: employeeId,
          status: reviewStatus,
          sampling_reason: samplingReason,
        },
        { onConflict: "order_id", ignoreDuplicates: true }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("qc_reviews")
      .select()
      .eq("order_id", orderId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ review: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

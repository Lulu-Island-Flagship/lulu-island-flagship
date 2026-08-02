import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/hours-disputes
 *
 * v8.3 auditoría 2026-07-21 (D-P1-5): no existía ningún endpoint de listado
 * para las disputas de horas -- el admin solo podía resolver una disputa
 * (POST [id]/resolve) si el empleado le pasaba el UUID del ticket por otro
 * canal. Y `sla_due_at` (escrito en
 * src/app/api/empleado/hours-dispute/route.ts:151, ventana de 24h) no tenía
 * ningún consumidor en todo `src/` -- se guardaba y nadie lo leía.
 *
 * `sla_due_at` vive dentro de `tickets_disputas.context` (JSONB), no como
 * columna propia (ver 010_modulo7_qc_score_tables.sql:136-150) -- por eso el
 * orden y el cálculo de "vencido" se hacen en memoria después del SELECT en
 * vez de con `.order()` sobre una columna, que no soporta expresiones JSONB
 * de forma portable con el query builder de supabase-js.
 *
 * Mismo recurso RBAC que [id]/resolve/route.ts ("tickets").
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("tickets", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { supabase } = auth;

  try {
    const { data: tickets, error } = await supabase
      .from("tickets_disputas")
      .select("id, order_id, employee_id, priority, status, context, resolution_note, resolved_by, resolved_at, created_at")
      .eq("type", "hours_dispute")
      .in("status", ["open", "in_review"]);

    if (error) {
      console.error("admin/hours-disputes error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const now = Date.now();

    const disputes = (tickets || []).map((t) => {
      const ctx = (t.context as Record<string, unknown>) || {};
      const slaDueAt = typeof ctx.sla_due_at === "string" ? ctx.sla_due_at : null;
      const overdue = slaDueAt ? new Date(slaDueAt).getTime() < now : false;
      return {
        id: t.id,
        orderId: t.order_id,
        employeeId: t.employee_id,
        priority: t.priority,
        status: t.status,
        claimedEventType: ctx.claimed_event_type ?? null,
        slaDueAt,
        overdue,
        createdAt: t.created_at,
      };
    });

    // Más urgentes primero: sin sla_due_at al final, luego ascendente por
    // fecha límite (las que ya vencieron quedan primero por construcción).
    disputes.sort((a, b) => {
      if (!a.slaDueAt && !b.slaDueAt) return 0;
      if (!a.slaDueAt) return 1;
      if (!b.slaDueAt) return -1;
      return new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime();
    });

    return NextResponse.json({ disputes }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

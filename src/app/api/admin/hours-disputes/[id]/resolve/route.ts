import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * POST /api/admin/hours-disputes/[id]/resolve
 *
 * v8.3 FIX-9 — contraparte admin de POST /api/empleado/hours-dispute.
 * "Falla técnica nunca penaliza" (D.3 #7): la acción "approve_correction"
 * existe específicamente para el caso donde el T registrado está mal por un
 * problema técnico (GPS, offline queue, crash) y no por culpa del empleado
 * -- en ese caso el admin corrige el service_logs.timestamp directamente
 * (nunca penaliza reduciendo la hora pagada por debajo de lo reclamado).
 *
 * Body: { action: "approve_correction" | "reject", resolutionNote?: string,
 *         correctedTimestamp?: ISO string }
 *   - approve_correction: si se pasa correctedTimestamp, actualiza el
 *     service_logs correspondiente (mismo order_id+employee_id+event_type)
 *     al valor corregido. Si el log no existe (ej. nunca se registró
 *     t_out por falla técnica), lo crea.
 *   - reject: deja el registro tal cual estaba, con la nota del admin.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("tickets", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const supabase = auth.supabase;
    const userId = auth.user.id;
    const ticketId = params.id;
    const body = await request.json();
    const { action, resolutionNote, correctedTimestamp } = body;

    if (!["approve_correction", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Use 'approve_correction' or 'reject'." },
        { status: 400 }
      );
    }

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets_disputas")
      .select("id, order_id, employee_id, type, status, context")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
    }

    if (ticket.type !== "hours_dispute") {
      return NextResponse.json({ error: "Not an hours dispute ticket" }, { status: 400 });
    }

    if (!["open", "in_review"].includes(ticket.status)) {
      return NextResponse.json({ error: "Dispute already resolved" }, { status: 409 });
    }

    const ctx = (ticket.context as Record<string, unknown>) || {};
    const claimedEventType = ctx.claimed_event_type as string | undefined;

    if (action === "approve_correction" && correctedTimestamp) {
      if (!claimedEventType) {
        return NextResponse.json(
          { error: "Ticket missing claimed_event_type in context — cannot apply correction" },
          { status: 500 }
        );
      }

      const { data: existingLog } = await supabase
        .from("service_logs")
        .select("id")
        .eq("order_id", ticket.order_id)
        .eq("employee_id", ticket.employee_id)
        .eq("event_type", claimedEventType)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLog) {
        const { error: updateLogError } = await supabase
          .from("service_logs")
          .update({ timestamp: correctedTimestamp, notes: `Corrected via hours dispute ${ticketId} (admin ${userId})` })
          .eq("id", existingLog.id);
        if (updateLogError) {
          return NextResponse.json({ error: updateLogError.message }, { status: 500 });
        }
      } else {
        // Falla técnica: el evento nunca se registró. Se crea ahora con el
        // timestamp corregido para que la hora pagada refleje la realidad
        // reclamada por el empleado, no un cero por ausencia de registro.
        const { error: insertLogError } = await supabase.from("service_logs").insert({
          order_id: ticket.order_id,
          employee_id: ticket.employee_id,
          event_type: claimedEventType,
          timestamp: correctedTimestamp,
          notes: `Created via hours dispute ${ticketId} (admin ${userId}) -- technical failure, never penalize`,
        });
        if (insertLogError) {
          return NextResponse.json({ error: insertLogError.message }, { status: 500 });
        }
      }
    }

    const { data: updatedTicket, error: updateError } = await supabase
      .from("tickets_disputas")
      .update({
        status: "resolved",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
        resolution_note:
          resolutionNote ||
          (action === "approve_correction" ? "Hours corrected" : "Dispute rejected"),
      })
      .eq("id", ticketId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ticket: updatedTicket, action, resolvedBy: userId }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Hours dispute resolve error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

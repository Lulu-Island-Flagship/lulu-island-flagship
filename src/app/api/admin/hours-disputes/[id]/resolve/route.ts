import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";
import { isValidUuid } from "@/lib/validation";

// Fix (pentest, hallazgo independiente #2, 2026-08-02): correctedTimestamp
// no se validaba -- ni formato ISO 8601 ni rango razonable. Un admin (o una
// llamada directa a la API sin pasar por la UI) podía escribir cualquier
// string en service_logs.timestamp (fecha futura, fecha absurdamente
// antigua, o un valor no parseable que rompiera consultas/reportes de
// nómina río abajo). Límite de antigüedad elegido: 90 días -- suficiente
// para cubrir cualquier disputa de horas real (que se abre poco después del
// servicio) sin permitir reescribir historial arbitrariamente viejo.
const MAX_CORRECTED_TIMESTAMP_AGE_DAYS = 90;

function isValidCorrectedTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (isNaN(Date.parse(value))) return false;
  const parsed = new Date(value);
  const now = new Date();
  if (parsed.getTime() > now.getTime()) return false;
  const minAllowed = new Date(now.getTime() - MAX_CORRECTED_TIMESTAMP_AGE_DAYS * 24 * 60 * 60 * 1000);
  if (parsed.getTime() < minAllowed.getTime()) return false;
  return true;
}

/**
 * POST /api/admin/hours-disputes/[id]/resolve
 *
 * v8.3 FIX-9 — contraparte admin de POST /api/employee/hours-dispute.
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
 *
 * D-P1-4 (auditoría 2026-07-21): ganar una disputa de horas corrige
 * service_logs pero el modelo de pago real es por Day Rate
 * (employees.day_rate), no por horas registradas -- no existe en el repo
 * ningún cálculo de "más horas registradas = más pago" que aplicar aquí de
 * forma automática (verificado: src/lib/payroll.ts no tiene ninguna
 * referencia a "dispute", y no existe una tabla de "ajustes pendientes de
 * nómina" tipo hhe-adjustments para disputas). Inventar un cálculo
 * automático sobre nómina real sin especificación de negocio de cómo se
 * traduce una corrección de horas a un ajuste de Day Rate sería más
 * arriesgado que no tocarlo. Mitigación mínima: cuando la disputa se
 * resuelve a favor del empleado (approve_correction), se publica una
 * alerta en unified_alerts dirigida a nómina para que un humano revise si
 * corresponde un ajuste manual -- en vez de dejarlo completamente
 * silencioso, que es el comportamiento actual sin este cambio.
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

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "tickets", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const supabase = auth.supabase;
    const userId = auth.user.id;
    const ticketId = params.id;
    if (!isValidUuid(ticketId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    const body = await request.json();
    const { action, resolutionNote, correctedTimestamp } = body;

    if (!["approve_correction", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action. Use 'approve_correction' or 'reject'." },
        { status: 400 }
      );
    }

    if (correctedTimestamp !== undefined && !isValidCorrectedTimestamp(correctedTimestamp)) {
      return NextResponse.json(
        {
          error:
            `correctedTimestamp inválido: debe ser una fecha ISO 8601 válida, no futura, ` +
            `y de no más de ${MAX_CORRECTED_TIMESTAMP_AGE_DAYS} días de antigüedad.`,
        },
        { status: 400 }
      );
    }

    // Migración 322: el chequeo de tipo/estado previo, la corrección de
    // service_logs (afecta nómina) y el UPDATE final del ticket ocurren
    // atómicamente dentro de resolve_hours_dispute_atomic (SELECT ... FOR
    // UPDATE + misma transacción), en vez de leer/chequear/escribir
    // service_logs/actualizar el ticket en llamadas HTTP separadas -- eso
    // permitía que dos POST concurrentes aplicaran la corrección de horas
    // dos veces sobre service_logs antes de que cualquiera de los dos
    // marcara el ticket como resuelto.
    const { data: updatedTicket, error: rpcError } = await supabase
      .rpc("resolve_hours_dispute_atomic", {
        p_ticket_id: ticketId,
        p_action: action,
        p_resolution_note: resolutionNote ?? null,
        p_corrected_timestamp: correctedTimestamp ?? null,
        p_resolver_user_id: userId,
      })
      .single();

    if (rpcError) {
      if (rpcError.message?.includes("DISPUTE_NOT_FOUND")) {
        return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
      }
      if (rpcError.message?.includes("NOT_HOURS_DISPUTE")) {
        return NextResponse.json({ error: "Not an hours dispute ticket" }, { status: 400 });
      }
      if (rpcError.message?.includes("DISPUTE_ALREADY_RESOLVED")) {
        return NextResponse.json({ error: "Dispute already resolved" }, { status: 409 });
      }
      if (rpcError.message?.includes("MISSING_CLAIMED_EVENT_TYPE")) {
        return NextResponse.json(
          { error: "Ticket missing claimed_event_type in context — cannot apply correction" },
          { status: 500 }
        );
      }
      console.error("admin/hours-disputes/[id]/resolve error:", rpcError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // D-P1-4: la alerta de nómina (cuando action === 'approve_correction')
    // ya se publicó dentro del RPC, en la misma transacción que la
    // resolución del ticket -- de forma best-effort (un fallo del INSERT en
    // unified_alerts no revierte la resolución, ver EXCEPTION WHEN OTHERS
    // en la migración 322).

    return NextResponse.json({ ticket: updatedTicket, action, resolvedBy: userId }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

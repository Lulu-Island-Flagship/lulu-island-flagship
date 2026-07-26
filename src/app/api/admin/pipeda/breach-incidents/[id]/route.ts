import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * PATCH /api/admin/pipeda/breach-incidents/[id] — v8.3 E9.9. Registra las
 * notificaciones (OIPC BC / afectados) y el cierre del incidente. No
 * reescribe `description`/`affected_client_ids`/`severity` a propósito --
 * esos campos están dentro del hash-chain y cambiarlos rompería la cadena
 * de integridad; si el contenido original estaba mal, se abre un nuevo
 * incidente que lo referencie, no se edita el viejo.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { action, status } = body as { action?: string; status?: string };

    const { data: incident, error: fetchError } = await supabase
      .from("data_breach_incidents")
      .select("id, oipc_notified_at, affected_notified_at, status")
      .eq("id", params.id)
      .is("deleted_at", null)
      .single();

    if (fetchError || !incident) {
      return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    }

    const updatePayload: Record<string, unknown> = {};
    const nowIso = new Date().toISOString();

    if (action === "notify_oipc") {
      updatePayload.oipc_notified_at = nowIso;
    } else if (action === "notify_affected") {
      updatePayload.affected_notified_at = nowIso;
    } else if (action === "set_status") {
      if (!["open", "contained", "closed"].includes(status || "")) {
        return NextResponse.json({ error: "status must be open, contained, or closed" }, { status: 400 });
      }
      updatePayload.status = status;
    } else {
      return NextResponse.json({ error: "action must be notify_oipc, notify_affected, or set_status" }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from("data_breach_incidents")
      .update(updatePayload)
      .eq("id", incident.id)
      .select()
      .single();

    if (error) {
      console.error("admin/pipeda/breach-incidents/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ incident: updated }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

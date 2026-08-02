import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * PATCH /api/admin/pipeda/breach-incidents/[id] — v8.3 E9.9. Registra las
 * notificaciones (OIPC BC / afectados) y el cierre del incidente. No
 * reescribe `description`/`affected_client_ids`/`severity` a propósito --
 * esos campos están dentro del hash-chain y cambiarlos rompería la cadena
 * de integridad; si el contenido original estaba mal, se abre un nuevo
 * incidente que lo referencie, no se edita el viejo.
 *
 * LIMITACIÓN DE ALCANCE (auditoría 2026-07-31, item 1): `notify_oipc` y
 * `notify_affected` NO envían ningún email/carta/llamada real al OIPC de BC
 * ni a las personas afectadas -- solo escriben un timestamp confirmando que
 * el admin YA notificó por su cuenta, fuera de este sistema (proceso legal
 * bajo PIPA de BC, no técnico). Construir una integración de envío real
 * (qué canal usa el OIPC, plantillas legales, evidencia de entrega) es una
 * decisión legal/de negocio fuera de alcance de este fix; NO se improvisa
 * aquí. Lo que sí se corrigió: la UI (src/app/[locale]/admin/pipeda/page.tsx)
 * ahora dice explícitamente "confirmo que ENVIÉ esto manualmente" en vez de
 * "marcar como notificado" (ambiguo, podía leerse como que el sistema lo
 * hizo). Si en el futuro se agrega envío automático real, hacerlo en una
 * acción NUEVA (ej. "send_oipc_notification") sin tocar el significado de
 * estos dos campos existentes.
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
        return safeErrorResponse(err);
  }
}

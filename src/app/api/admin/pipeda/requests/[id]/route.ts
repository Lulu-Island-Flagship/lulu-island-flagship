import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computePurgeEligibleAt } from "@/lib/pipeda";

/**
 * PATCH /api/admin/pipeda/requests/[id] — v8.3 E9.9. Avanza el estado de
 * una solicitud PIPEDA.
 *
 * - access: status -> completed junto con `exportReference` (dónde quedó
 *   el archivo que el admin armó manualmente).
 * - correction: status -> completed una vez aplicado el cambio en el
 *   perfil del cliente (este endpoint NO aplica el cambio por sí mismo --
 *   el admin lo hace en la pantalla de cliente correspondiente y aquí solo
 *   cierra el ticket de la solicitud, para no duplicar lógica de edición
 *   de perfil que ya existe en otra parte).
 * - deletion: status -> completed dispara el soft-delete real de
 *   client_profiles (deleted_at) + fija `purge_eligible_at` a hoy + 2 años
 *   de retención fiscal (E9.9/E9.12). El purge físico NO ocurre aquí --
 *   necesitaría un job aparte que respete `purge_eligible_at` en todas las
 *   tablas relacionadas, fuera de alcance de este endpoint.
 * - denied: cualquier tipo, con `denialReason` obligatorio.
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
    const { action, exportReference, denialReason } = body as {
      action?: string;
      exportReference?: string;
      denialReason?: string;
    };

    const { data: reqRow, error: fetchError } = await supabase
      .from("data_subject_requests")
      .select("id, client_user_id, request_type, status")
      .eq("id", params.id)
      .is("deleted_at", null)
      .single();

    if (fetchError || !reqRow) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }
    if (reqRow.status === "completed" || reqRow.status === "denied") {
      return NextResponse.json({ error: `Request already ${reqRow.status}` }, { status: 409 });
    }

    if (action === "start_processing") {
      const { data: updated, error } = await supabase
        .from("data_subject_requests")
        .update({ status: "processing", processed_by_admin: auth.user.id })
        .eq("id", reqRow.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ request: updated }, { status: 200 });
    }

    if (action === "deny") {
      if (!denialReason || denialReason.trim().length === 0) {
        return NextResponse.json({ error: "denialReason is required" }, { status: 400 });
      }
      const { data: updated, error } = await supabase
        .from("data_subject_requests")
        .update({
          status: "denied",
          denial_reason: denialReason.trim(),
          processed_by_admin: auth.user.id,
          completed_at: new Date().toISOString(),
        })
        .eq("id", reqRow.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ request: updated }, { status: 200 });
    }

    if (action === "complete") {
      if (reqRow.request_type === "access" && (!exportReference || exportReference.trim().length === 0)) {
        return NextResponse.json({ error: "exportReference is required to complete an access request" }, { status: 400 });
      }

      const nowIso = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        status: "completed",
        processed_by_admin: auth.user.id,
        completed_at: nowIso,
      };
      if (reqRow.request_type === "access") {
        updatePayload.export_reference = exportReference!.trim();
      }
      if (reqRow.request_type === "deletion") {
        const purgeEligibleAt = computePurgeEligibleAt(new Date());
        updatePayload.purge_eligible_at = purgeEligibleAt.toISOString();

        // Soft delete real del perfil, invariante universal del sistema
        // (deleted_at + trigger prevent_hard_delete en todas las tablas).
        await supabase
          .from("client_profiles")
          .update({ deleted_at: nowIso })
          .eq("user_id", reqRow.client_user_id);
      }

      const { data: updated, error } = await supabase
        .from("data_subject_requests")
        .update(updatePayload)
        .eq("id", reqRow.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ request: updated }, { status: 200 });
    }

    return NextResponse.json({ error: "action must be start_processing, complete, or deny" }, { status: 400 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

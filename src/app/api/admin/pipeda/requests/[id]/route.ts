import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
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
 *   client_profiles + profiles + orders + quotes + client_properties +
 *   communication_log (deleted_at) + fija `purge_eligible_at` a hoy + 2 años
 *   de retención fiscal (E9.9/E9.12).
 *
 *   v8.3 fix E-B5 (auditoría RBAC/compliance 2026-07-21): antes esto SOLO
 *   tocaba client_profiles, dejando el resto de tablas con PII intactas --
 *   "cumplimiento aparente" según el hallazgo. Se amplía a las tablas que
 *   SÍ tienen `deleted_at` (migración 039 + 212) y una relación directa con
 *   el titular. Límites de alcance que siguen sin resolver aquí, a
 *   propósito, documentados y no simulados:
 *     - `wallet_transactions` es inmutable (Grupo B, sin `deleted_at`) --
 *       registro contable, no se toca.
 *     - Fotos en Supabase Storage: este endpoint solo toca Postgres, no
 *       hace llamadas a Storage.
 *     - El purge FÍSICO (más allá de deleted_at) NO ocurre aquí ni en
 *       ningún cron existente hoy -- `purge_eligible_at` se escribe pero
 *       ningún job lo consume todavía (fuera de alcance de este endpoint;
 *       requeriría un cron nuevo).
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
      if (error) {
        console.error("admin/pipeda/requests/[id] error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
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
      if (error) {
        console.error("admin/pipeda/requests/[id] error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
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

        // v8.3 fix E-B5: cascada de soft-delete real sobre todas las tablas
        // con `deleted_at` y una relación directa al titular -- antes solo
        // se tocaba client_profiles. Se usa el cliente de service role: NI
        // orders, NI quotes, NI profiles, NI client_properties tienen una
        // política UPDATE que permita a un admin (ni siquiera owner_admin)
        // tocar la fila de OTRO usuario -- solo "auth.uid() = user_id" (ver
        // 001/019). Bajo el cliente RLS de la sesión del admin este UPDATE
        // afectaría 0 filas SIN error, dejando el "borrado" en apariencia
        // otra vez. requireAdminRole() ya autorizó el recurso "compliance"
        // (solo owner_admin) y dejó rastro en admin_action_logs -- mismo
        // patrón que /api/admin/access-recovery/route.ts. Cada UPDATE es
        // independiente y no bloqueante entre sí (si una falla, las demás
        // igual se intentan) para no dejar el borrado a medias por un solo
        // error de una tabla secundaria; el resultado se agrega y se
        // reporta.
        const serviceClient = getServiceRoleClient();
        if (!serviceClient) {
          return NextResponse.json(
            { error: "PIPEDA deletion cascade is not configured on this environment (service role missing)" },
            { status: 500 }
          );
        }

        const { data: clientProfile } = await serviceClient
          .from("client_profiles")
          .select("id")
          .eq("user_id", reqRow.client_user_id)
          .maybeSingle();

        const cascadeResults = await Promise.allSettled([
          serviceClient.from("client_profiles").update({ deleted_at: nowIso }).eq("user_id", reqRow.client_user_id),
          serviceClient.from("profiles").update({ deleted_at: nowIso }).eq("id", reqRow.client_user_id),
          serviceClient.from("orders").update({ deleted_at: nowIso }).eq("user_id", reqRow.client_user_id).is("deleted_at", null),
          serviceClient.from("quotes").update({ deleted_at: nowIso }).eq("user_id", reqRow.client_user_id).is("deleted_at", null),
          serviceClient.from("communication_log").update({ deleted_at: nowIso }).eq("user_id", reqRow.client_user_id).is("deleted_at", null),
          ...(clientProfile
            ? [
                serviceClient
                  .from("client_properties")
                  .update({ deleted_at: nowIso })
                  .eq("client_profile_id", clientProfile.id)
                  .is("deleted_at", null),
              ]
            : []),
        ]);

        const cascadeErrors = cascadeResults
          .map((r, i) => (r.status === "fulfilled" && r.value.error ? { i, message: r.value.error.message } : null))
          .filter((x): x is { i: number; message: string } => x !== null);
        if (cascadeErrors.length > 0) {
          // No se aborta la solicitud por esto -- client_profiles (el soft
          // delete "central") ya se intentó igual que el resto, y el admin
          // necesita poder cerrar el ticket dentro del SLA de 48h aunque una
          // tabla secundaria falle. Se deja rastro en la respuesta.
          updatePayload.correction_details = `[E-B5] Cascada de borrado con errores parciales: ${JSON.stringify(cascadeErrors)}`;
        }
      }

      const { data: updated, error } = await supabase
        .from("data_subject_requests")
        .update(updatePayload)
        .eq("id", reqRow.id)
        .select()
        .single();
      if (error) {
        console.error("admin/pipeda/requests/[id] error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      return NextResponse.json({ request: updated }, { status: 200 });
    }

    return NextResponse.json({ error: "action must be start_processing, complete, or deny" }, { status: 400 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

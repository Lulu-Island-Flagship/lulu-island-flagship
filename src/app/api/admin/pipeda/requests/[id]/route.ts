import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import { isValidUuid } from "@/lib/validation";
import { safeErrorResponse } from "@/lib/api-errors";

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
 *       hace llamadas a Storage. Confirmado como gap real (auditoría
 *       2026-07-31, item 4) -- NO se implementa aquí a propósito: borrar
 *       archivos de Storage exige saber con certeza qué rutas pertenecen
 *       SOLO a este titular (fotos de checklist pueden estar compartidas
 *       en un mismo `order` con otro personal/cliente vía join tables) y
 *       una decisión de negocio sobre si las fotos de servicio se
 *       consideran PII purgable o evidencia operativa que debe conservarse
 *       igual que `wallet_transactions`. Requiere diseño explícito, no un
 *       parche apurado que arriesgue borrar evidencia de otro titular.
 *     - `auth.users` (tabla del sistema Auth de Supabase, fuera del schema
 *       `public`) NO se anonimiza ni se toca aquí. Confirmado como gap real
 *       (mismo hallazgo) -- tampoco se implementa hoy: escribir sobre
 *       `auth.users` requiere `service_role` apuntando al schema `auth`
 *       (distinto de las tablas `public.*` que ya usa este cascade) y
 *       puede romper el login/sesión activa del usuario de forma
 *       impredecible si no se coordina con Supabase Auth (ej. invalidar
 *       sesiones, refresh tokens). Recomendación: endpoint/cron dedicado
 *       que use `supabase.auth.admin.updateUserById()` (SDK admin oficial,
 *       no UPDATE directo a la tabla) para anonimizar email/phone tras el
 *       período de retención, evaluado y construido aparte.
 *     - El purge FÍSICO (más allá de deleted_at) NO ocurre aquí ni en
 *       ningún cron existente hoy -- `purge_eligible_at` se escribe pero
 *       ningún job lo consume todavía (fuera de alcance de este endpoint;
 *       requeriría un cron nuevo).
 * - denied: cualquier tipo, con `denialReason` obligatorio.
 */
export async function PATCH(
  request: NextRequest,
  { params: paramsPromise }: { params: Promise<{ id: string }> })
{
  const params = await paramsPromise;
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  // Fix (auditoría de integridad de datos 2026-08-01): params.id no se
  // validaba como UUID antes de usarse contra data_subject_requests (y, para
  // deletion, contra el cascade de borrado de client_profiles/orders/etc).
  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: "Invalid request id" }, { status: 400 });
  }

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
        // Fix (pentest 2026-08-02, migración 329): antes esto disparaba 6
        // UPDATEs independientes (Promise.allSettled) desde este route
        // handler, sin transacción -- si uno fallaba a mitad de camino, las
        // tablas ya actualizadas quedaban con deleted_at escrito
        // PERMANENTEMENTE aunque el resto del cascade nunca se completara
        // (estado real a medias en la base, no solo un status mal
        // reportado). Ahora todo el cascade (client_profiles, profiles,
        // orders, quotes, communication_log, client_properties +
        // data_subject_requests) corre dentro de una única función
        // SECURITY DEFINER (pipeda_execute_deletion_cascade, ver esa
        // migración) cuyo cuerpo revierte TODO el cascade si cualquier paso
        // falla -- nunca queda una tabla parcialmente actualizada. La
        // función misma decide y persiste el status final ('completed' o
        // 'partial_failure' con `deletion_errors`), así que aquí no se
        // arma `updatePayload` ni se hace un UPDATE aparte a
        // data_subject_requests para este tipo de solicitud.
        const serviceClient = getServiceRoleClient();
        if (!serviceClient) {
          return NextResponse.json(
            { error: "PIPEDA deletion cascade is not configured on this environment (service role missing)" },
            { status: 500 }
          );
        }

        const { data: cascadeResult, error: cascadeError } = await serviceClient.rpc(
          "pipeda_execute_deletion_cascade",
          {
            p_request_id: reqRow.id,
            p_admin_user_id: auth.user.id,
          }
        );

        if (cascadeError) {
          console.error("admin/pipeda/requests/[id] cascade RPC error:", cascadeError.message);
          return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
        }

        const responseStatus = cascadeResult?.status === "partial_failure" ? 207 : 200;
        return NextResponse.json({ request: cascadeResult }, { status: responseStatus });
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
        return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import {
  getActiveSuccessors,
  issueEmergencyAccessCodes,
  logRecoveryAuditEvent,
  renderCatalogTemplate,
  sendToSuccessor,
} from "@/lib/access-recovery-server";

/**
 * GET /api/admin/access-recovery — lista solicitudes de recuperación
 * (todos los estados) para que un owner_admin ya autenticado pueda
 * revisarlas y aprobar/denegar. Nunca expone verification_code_hash ni
 * co_verification_code_hash en la respuesta.
 *
 * POST /api/admin/access-recovery:
 *   { action: "approve", requestId }
 *     -- solo válido si status = 'verified_pending_approval'. Vía de
 *     aprobación humana cuando hay un owner_admin (u otro rol con este
 *     recurso) todavía con sesión activa -- la otra vía es doble
 *     verificación de 2 trusted_successors distintos, ver
 *     src/app/api/recovery/co-verify/route.ts. Emite el código de
 *     emergencia (reusa owner_admin_backup_codes) y lo devuelve en la
 *     respuesta -- visible solo para este admin autenticado.
 *   { action: "deny", requestId, denialReason }
 *
 * Recurso RBAC 'access_recovery': solo owner_admin (src/lib/admin-rbac.ts)
 * -- otorgar acceso de emergencia es tan sensible como manejar los propios
 * backup codes del dueño.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("access_recovery", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // v8.3 fix C-H8 (auditoría RBAC 2026-07-21): access_recovery_requests
  // tiene RLS "false/false" (203_e11_access_recovery_requests.sql:87) --
  // solo service role puede leerla o escribirla. El cliente anon+cookies de
  // requireAdminRole() ya autorizó (rol + audit log) pero NO puede tocar
  // esta tabla: antes este GET devolvía siempre una lista vacía sin error,
  // así que el dueño nunca veía las solicitudes pendientes. Mismo patrón
  // que el POST de esta misma ruta.
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Recovery flow is not configured on this environment" }, { status: 500 });
  }

  const { data, error } = await serviceClient
    .from("access_recovery_requests")
    .select(
      "id, successor_id, status, verification_method, verified_at, reason, created_at, resolved_at, resolved_by, denial_reason, emergency_code_issued_at, co_verifier_successor_id, co_verified_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ requests: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("access_recovery", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Se usa service role para las operaciones sobre la tabla (RLS es
  // false/false, ver 202_e11_access_recovery_requests.sql) -- requireAdminRole
  // ya autorizó y dejó rastro en admin_action_logs; este cliente es solo
  // para los datos, mismo patrón documentado en src/lib/admin.ts.
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Recovery flow is not configured on this environment" }, { status: 500 });
  }

  try {
    const body = await request.json();

    if (body.action === "approve") {
      if (!body.requestId) {
        return NextResponse.json({ error: "requestId is required" }, { status: 400 });
      }

      const { data: reqRow, error: fetchError } = await serviceClient
        .from("access_recovery_requests")
        .select("id, status, successor_id, reason")
        .eq("id", body.requestId)
        .maybeSingle();

      if (fetchError || !reqRow) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      if (reqRow.status !== "verified_pending_approval") {
        return NextResponse.json(
          { error: `Request status is '${reqRow.status}', expected 'verified_pending_approval'` },
          { status: 400 }
        );
      }

      const issuedCodes = await issueEmergencyAccessCodes(serviceClient);
      if (issuedCodes.length === 0) {
        return NextResponse.json({ error: "No active owner_admin account found to issue an emergency code for" }, { status: 500 });
      }

      const { error: resolveError } = await serviceClient
        .from("access_recovery_requests")
        .update({
          status: "approved",
          resolved_at: new Date().toISOString(),
          resolved_by: `admin:${auth.user.email ?? auth.user.id}`,
          resolved_by_admin_user_id: auth.user.id,
          emergency_code_issued_at: new Date().toISOString(),
        })
        .eq("id", reqRow.id)
        .eq("status", "verified_pending_approval");

      if (resolveError) {
        return NextResponse.json({ error: resolveError.message }, { status: 500 });
      }

      await logRecoveryAuditEvent(serviceClient, {
        requestId: reqRow.id,
        eventType: "admin_approved",
        actorType: "admin",
        actorRef: auth.user.id,
      });
      await logRecoveryAuditEvent(serviceClient, {
        requestId: reqRow.id,
        eventType: "emergency_code_issued",
        actorType: "system",
        detail: `${issuedCodes.length} código(s) de emergencia emitido(s) para owner_admin(s) activos`,
      });

      // Copia al successor original, para que lo pueda relayar al manager.
      const successors = await getActiveSuccessors(serviceClient);
      const requester = successors.find((s) => s.id === reqRow.successor_id);
      if (requester && issuedCodes[0]) {
        const rendered =
          (await renderCatalogTemplate(serviceClient, "access_recovery_emergency_code_issued", {
            code: issuedCodes[0].code,
          })) ?? `Lulu Island Flagship: código de emergencia de un solo uso: ${issuedCodes[0].code} (expira en 1 hora).`;
        await sendToSuccessor(requester, rendered);
      }

      return NextResponse.json({
        status: "approved",
        // Visible SOLO en la respuesta a este admin autenticado -- nunca se
        // persiste en texto plano (mismo trade-off documentado en
        // owner_admin_backup_codes / backup-codes route.ts).
        emergencyCodes: issuedCodes,
        warning: "Estos códigos no se van a volver a mostrar. Compártelos de forma segura con el manager.",
      });
    }

    if (body.action === "deny") {
      if (!body.requestId) {
        return NextResponse.json({ error: "requestId is required" }, { status: 400 });
      }
      const { data: denied, error: denyError } = await serviceClient
        .from("access_recovery_requests")
        .update({
          status: "denied",
          resolved_at: new Date().toISOString(),
          resolved_by: `admin:${auth.user.email ?? auth.user.id}`,
          resolved_by_admin_user_id: auth.user.id,
          denial_reason: body.denialReason ? String(body.denialReason).trim() : null,
        })
        .eq("id", body.requestId)
        .in("status", ["pending_verification", "verified_pending_approval"])
        .select("id")
        .maybeSingle();

      if (denyError) {
        return NextResponse.json({ error: denyError.message }, { status: 500 });
      }
      if (!denied) {
        return NextResponse.json({ error: "Request not found or already resolved" }, { status: 404 });
      }

      await logRecoveryAuditEvent(serviceClient, {
        requestId: denied.id,
        eventType: "admin_denied",
        actorType: "admin",
        actorRef: auth.user.id,
        detail: body.denialReason ? String(body.denialReason).trim() : null,
      });

      return NextResponse.json({ status: "denied" });
    }

    return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

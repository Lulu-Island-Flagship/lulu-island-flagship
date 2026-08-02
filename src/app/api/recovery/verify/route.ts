import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/admin";
import { hashVerificationCode, isExpired, MAX_VERIFICATION_ATTEMPTS } from "@/lib/access-recovery";
import {
  getActiveSuccessors,
  logRecoveryAuditEvent,
  maskSuccessorContact,
  otherActiveSuccessors,
  renderCatalogTemplate,
  sendToSuccessor,
  type TrustedSuccessorRow,
} from "@/lib/access-recovery-server";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { getClientIp } from "@/lib/request-ip";

/**
 * POST /api/recovery/verify — confirma el código de verificación enviado por
 * /api/recovery/request. Público (sin sesión — el successor no tiene
 * cuenta), pero el único secreto válido es el código que solo llegó al
 * canal ya registrado.
 *
 * Body: { requestId: string, code: string }
 *
 * Al verificar con éxito:
 *   1. status -> 'verified_pending_approval' (NINGÚN acceso se otorga aquí).
 *   2. Alerta a la bandeja unificada (publishUnifiedAlert) -- visible para
 *      cualquier admin con acceso al panel, sin depender de que alguien
 *      revise su correo.
 *   3. Notifica por SMS/email a TODOS los demás trusted_successors activos
 *      (si hay más de uno) -- objetivo explícito: que sea imposible que
 *      esto pase en secreto.
 */
export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Recovery flow is not configured on this environment" }, { status: 500 });
  }

  let body: { requestId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.requestId || typeof body.requestId !== "string") {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }
  if (!body.code || typeof body.code !== "string") {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { data: rateLimitData, error: rateLimitError } = await serviceClient.rpc("check_rate_limit", {
    p_ip_address: `access-recovery-verify:${ip}`,
    p_max_requests: 10,
  });
  // Fix (auditoría externa, hallazgo CRÍTICO): fallar CERRADO si el RPC de
  // rate limit falla, en vez de dejar pasar la petición como si no hubiera
  // límite.
  if (rateLimitError) {
    console.error("[recovery/verify] check_rate_limit error:", rateLimitError.message);
    return NextResponse.json({ error: "Service temporarily unavailable. Try again later." }, { status: 503 });
  }
  if (rateLimitData && rateLimitData[0]?.allowed === false) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { data: reqRow, error: fetchError } = await serviceClient
    .from("access_recovery_requests")
    .select(
      "id, status, successor_id, verification_code_hash, verification_code_expires_at, verification_attempts, reason"
    )
    .eq("id", body.requestId)
    .maybeSingle();

  if (fetchError || !reqRow) {
    return NextResponse.json({ error: "Invalid or expired request" }, { status: 401 });
  }

  if (reqRow.status !== "pending_verification") {
    return NextResponse.json({ error: "Invalid or expired request" }, { status: 401 });
  }

  if (isExpired(reqRow.verification_code_expires_at) || reqRow.verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
    await serviceClient
      .from("access_recovery_requests")
      .update({ status: "expired", resolved_at: new Date().toISOString(), resolved_by: "system:expired" })
      .eq("id", reqRow.id)
      .eq("status", "pending_verification");
    await logRecoveryAuditEvent(serviceClient, {
      requestId: reqRow.id,
      eventType: "verification_expired",
      actorType: "system",
      detail: "Código expirado o máximo de intentos alcanzado",
    });
    return NextResponse.json({ error: "Invalid or expired request" }, { status: 401 });
  }

  const codeHash = hashVerificationCode(body.code);

  // UPDATE atómico condicionado al hash correcto -- si dos requests llegan en
  // paralelo con el mismo código, solo una gana la fila (mismo patrón que
  // backup-codes/verify/route.ts).
  const { data: verified, error: verifyError } = await serviceClient
    .from("access_recovery_requests")
    .update({ status: "verified_pending_approval", verified_at: new Date().toISOString() })
    .eq("id", reqRow.id)
    .eq("status", "pending_verification")
    .eq("verification_code_hash", codeHash)
    .select("id, successor_id, reason")
    .maybeSingle();

  if (verifyError) {
    console.error("[recovery/verify] update error:", verifyError.message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  if (!verified) {
    await serviceClient
      .from("access_recovery_requests")
      .update({ verification_attempts: reqRow.verification_attempts + 1 })
      .eq("id", reqRow.id)
      .eq("status", "pending_verification");
    await logRecoveryAuditEvent(serviceClient, {
      requestId: reqRow.id,
      eventType: "verification_failed",
      actorType: "successor",
      detail: `Intento ${reqRow.verification_attempts + 1}/${MAX_VERIFICATION_ATTEMPTS}`,
    });
    return NextResponse.json({ error: "Invalid or expired request" }, { status: 401 });
  }

  const successors = await getActiveSuccessors(serviceClient);
  const requester = successors.find((s: TrustedSuccessorRow) => s.id === verified.successor_id);

  await logRecoveryAuditEvent(serviceClient, {
    requestId: verified.id,
    eventType: "verification_succeeded",
    actorType: "successor",
    actorRef: requester ? maskSuccessorContact(requester) : null,
  });

  // 2. Bandeja unificada -- visible en /admin/alerts sin depender de que
  // alguien revise correo/SMS.
  const alertResult = await publishUnifiedAlert(serviceClient, {
    sourceModule: "access_recovery",
    sourceTable: "access_recovery_requests",
    sourceId: verified.id,
    tier: "respond_10min",
    severity: "p1_urgent",
    title: `Recuperación de acceso verificada -- ${requester?.name ?? "contacto de confianza"}`,
    summary: verified.reason,
  });
  await logRecoveryAuditEvent(serviceClient, {
    requestId: verified.id,
    eventType: "unified_alert_published",
    actorType: "system",
    detail: alertResult.success ? "OK" : `Fallo: ${alertResult.error}`,
  });

  // 3. Notificar a TODOS los demás successors activos -- imposible que pase
  // en secreto.
  const others = requester ? otherActiveSuccessors(successors, requester.id) : successors;
  if (others.length > 0) {
    const rendered =
      (await renderCatalogTemplate(serviceClient, "access_recovery_other_successor_alert", {
        successor_name: requester?.name ?? "un contacto de confianza",
        reason: verified.reason,
      })) ??
      `Lulu Island Flagship: ${requester?.name ?? "un contacto de confianza"} verificó una solicitud de recuperación de acceso. Motivo: ${verified.reason}. Ningún acceso se otorgó todavía.`;

    for (const other of others) {
      const result = await sendToSuccessor(other, rendered);
      await logRecoveryAuditEvent(serviceClient, {
        requestId: verified.id,
        eventType: "other_successors_notified",
        actorType: "system",
        actorRef: maskSuccessorContact(other),
        detail: `Canal: ${result.channel}, estado: ${result.status}`,
      });
    }
  }

  return NextResponse.json({
    status: "verified_pending_approval",
    message:
      "Identidad verificada. La solicitud requiere aprobación humana adicional antes de otorgar cualquier acceso -- todos los demás contactos de confianza fueron notificados.",
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/admin";
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeExpiryIso,
  normalizeContact,
  validateReason,
} from "@/lib/access-recovery";
import {
  findActiveSuccessorByContact,
  logRecoveryAuditEvent,
  maskSuccessorContact,
  renderCatalogTemplate,
  sendToSuccessor,
} from "@/lib/access-recovery-server";

/**
 * POST /api/recovery/request — inicio PÚBLICO pero muy limitado de una
 * recuperación de acceso inmediata (Google/dispositivo perdido del
 * manager), distinta del Modo Sucesión por inactividad (src/lib/succession.ts).
 *
 * Body: { contact: string (teléfono o email), reason: string (min 10 chars) }
 *
 * No recibe ni acepta un ID interno de trusted_successors -- eso sería una
 * superficie de ataque adivinable. En vez de eso, busca el contacto
 * ingresado contra los YA REGISTRADOS en trusted_successors, y si hay
 * coincidencia única, manda el código de verificación al canal QUE YA
 * ESTABA GUARDADO (nunca a uno que el solicitante escriba aquí) -- esa es
 * la garantía central contra suplantación. Ver comentario largo en
 * supabase/migrations/202_e11_access_recovery_requests.sql.
 *
 * Respuesta SIEMPRE genérica (mismo mensaje exista o no coincidencia, sea
 * cual sea el error de validación de negocio) para no permitir enumerar
 * qué contactos están registrados como trusted_successors.
 */

const GENERIC_RESPONSE = {
  message:
    "Si el contacto coincide con un contacto de confianza registrado, se envió un código de verificación a su canal registrado.",
};

export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Recovery flow is not configured on this environment" }, { status: 500 });
  }

  let body: { contact?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const { data: rateLimitData } = await serviceClient.rpc("check_rate_limit", {
    p_ip_address: `access-recovery-request:${ip}`,
    p_max_requests: 5,
  });
  if (rateLimitData && rateLimitData[0]?.allowed === false) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const reasonError = validateReason(body.reason);
  if (reasonError) {
    return NextResponse.json({ error: reasonError }, { status: 400 });
  }
  if (!body.contact || typeof body.contact !== "string" || body.contact.trim().length === 0) {
    return NextResponse.json({ error: "contact is required" }, { status: 400 });
  }

  const reason = body.reason!.trim();
  const contact = normalizeContact(body.contact);

  const successor = await findActiveSuccessorByContact(serviceClient, contact);

  if (!successor) {
    // Rastro server-side SIN exponer el contacto ingresado (podría ser de
    // alguien ajeno al sistema) ni revelar al caller si hubo coincidencia.
    await logRecoveryAuditEvent(serviceClient, {
      eventType: "request_lookup_attempt",
      actorType: "successor",
      detail: "Contacto no coincide con ningún trusted_successor activo",
    });
    return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
  }

  const code = generateVerificationCode();
  const nowIso = new Date().toISOString();

  const { data: requestRow, error: insertError } = await serviceClient
    .from("access_recovery_requests")
    .insert({
      successor_id: successor.id,
      reason,
      status: "pending_verification",
      verification_method: successor.contact_phone ? "sms" : "email",
      verification_code_hash: hashVerificationCode(code),
      verification_code_expires_at: verificationCodeExpiryIso(nowIso),
    })
    .select("id")
    .single();

  if (insertError || !requestRow) {
    console.error("[recovery/request] insert failed:", insertError?.message);
    return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
  }

  await logRecoveryAuditEvent(serviceClient, {
    requestId: requestRow.id,
    eventType: "request_created",
    actorType: "successor",
    actorRef: maskSuccessorContact(successor),
    detail: `Solicitud creada por ${successor.name}`,
  });

  const rendered =
    (await renderCatalogTemplate(serviceClient, "access_recovery_verification_code", { code, reason })) ??
    `Lulu Island Flagship: tu código de verificación de recuperación de acceso es ${code} (vence en 15 minutos). Motivo: ${reason}`;

  const sendResult = await sendToSuccessor(successor, rendered);

  await logRecoveryAuditEvent(serviceClient, {
    requestId: requestRow.id,
    eventType: "verification_code_sent",
    actorType: "system",
    actorRef: maskSuccessorContact(successor),
    detail: `Canal: ${sendResult.channel}, estado: ${sendResult.status}`,
  });

  return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
}

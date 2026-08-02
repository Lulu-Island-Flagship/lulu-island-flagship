import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/admin";
import {
  generateVerificationCode,
  hashVerificationCode,
  verificationCodeExpiryIso,
  normalizeContact,
  isExpired,
  MAX_VERIFICATION_ATTEMPTS,
} from "@/lib/access-recovery";
import {
  findActiveSuccessorByContact,
  getActiveOwnerAdmins,
  issueEmergencyAccessCodes,
  logRecoveryAuditEvent,
  maskSuccessorContact,
  renderCatalogTemplate,
  sendToSuccessor,
} from "@/lib/access-recovery-server";
import { getClientIp } from "@/lib/request-ip";

/**
 * Vía de "doble verificación" para la aprobación humana obligatoria (paso 5
 * del flujo): si hay AL MENOS 2 trusted_successors activos, un SEGUNDO
 * contacto distinto del solicitante original puede aprobar la solicitud ya
 * verificada, confirmando su propia identidad exactamente igual que el
 * solicitante original -- código enviado a SU contacto ya registrado, nunca
 * a uno que escriba en el momento. Dos personas de confianza reales, cada
 * una verificada por posesión de su propio canal, sustituyen a "un admin ya
 * logueado" cuando (como es lo normal en un negocio de un solo dueño) no
 * hay nadie más con sesión admin activa para usar
 * /api/admin/access-recovery.
 *
 * POST { action: "request", requestId, contact }
 *   -- busca un successor activo DISTINTO del solicitante original cuyo
 *   contacto coincida, y le manda su propio código de co-verificación.
 * POST { action: "confirm", requestId, code }
 *   -- valida el código; si es correcto, la solicitud queda 'approved' Y se
 *   emite de inmediato el código de acceso de emergencia (reusa
 *   owner_admin_backup_codes, ver access-recovery-server.ts). Esto ES la
 *   aprobación humana -- no requiere un paso admin adicional.
 */
export async function POST(request: NextRequest) {
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Recovery flow is not configured on this environment" }, { status: 500 });
  }

  let body: { action?: string; requestId?: string; contact?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // v8.3 fix C-H9 (auditoría RBAC 2026-07-21): X-Forwarded-For lo controla el
  // cliente (cualquiera puede mandar un valor distinto en cada request).
  // Fix (pentest 2026-08-02): getClientIp() ahora prioriza
  // `x-vercel-forwarded-for`, que Vercel sobrescribe con la IP real de
  // conexión y el cliente no puede falsificar (ver src/lib/request-ip.ts) --
  // x-forwarded-for solo se usa como fallback fuera de Vercel. Aun así, como
  // mitigación adicional, se añade abajo un segundo límite por `requestId`,
  // que el cliente NO puede falsificar (es un UUID que solo conoce quien ya
  // pasó por /api/recovery/verify) y que no se resetea por cambiar de IP.
  const ip = getClientIp(request);
  const { data: rateLimitData, error: rateLimitError } = await serviceClient.rpc("check_rate_limit", {
    p_ip_address: `access-recovery-co-verify:${ip}`,
    p_max_requests: 10,
  });
  // Fix (auditoría externa, hallazgo CRÍTICO): fallar CERRADO si el RPC de
  // rate limit falla, en vez de dejar pasar la petición como si no hubiera
  // límite.
  if (rateLimitError) {
    console.error("[recovery/co-verify] check_rate_limit error (ip):", rateLimitError.message);
    return NextResponse.json({ error: "Service temporarily unavailable. Try again later." }, { status: 503 });
  }
  if (rateLimitData && rateLimitData[0]?.allowed === false) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  if (!body.requestId || typeof body.requestId !== "string") {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }

  // Segundo límite, por requestId, difícil de falsificar (ver comentario
  // arriba). Comparte presupuesto entre "request" y "confirm" para esta
  // solicitud concreta.
  const { data: requestIdRateLimitData, error: requestIdRateLimitError } = await serviceClient.rpc(
    "check_rate_limit",
    {
      p_ip_address: `access-recovery-co-verify-request:${body.requestId}`,
      p_max_requests: 10,
    }
  );
  // Fix (auditoría externa, hallazgo CRÍTICO): fallar CERRADO si el RPC de
  // rate limit falla, en vez de dejar pasar la petición como si no hubiera
  // límite.
  if (requestIdRateLimitError) {
    console.error("[recovery/co-verify] check_rate_limit error (requestId):", requestIdRateLimitError.message);
    return NextResponse.json({ error: "Service temporarily unavailable. Try again later." }, { status: 503 });
  }
  if (requestIdRateLimitData && requestIdRateLimitData[0]?.allowed === false) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { data: reqRow } = await serviceClient
    .from("access_recovery_requests")
    .select(
      "id, status, successor_id, reason, co_verifier_successor_id, co_verification_code_hash, co_verification_code_expires_at, co_verification_attempts"
    )
    .eq("id", body.requestId)
    .maybeSingle();

  if (!reqRow || reqRow.status !== "verified_pending_approval") {
    return NextResponse.json({ error: "Request is not eligible for co-verification" }, { status: 400 });
  }

  if (body.action === "request") {
    if (!body.contact || typeof body.contact !== "string") {
      return NextResponse.json({ error: "contact is required" }, { status: 400 });
    }
    const contact = normalizeContact(body.contact);
    const successor = await findActiveSuccessorByContact(serviceClient, contact);

    // Genérico a propósito: no revela si hubo o no coincidencia, y nunca
    // permite que el co-verificador sea la misma persona que ya inició la
    // solicitud (impediría la doble verificación real).
    if (!successor || successor.id === reqRow.successor_id) {
      await logRecoveryAuditEvent(serviceClient, {
        requestId: reqRow.id,
        eventType: "request_lookup_attempt",
        actorType: "successor",
        detail: "Co-verificación: contacto no coincide con un segundo successor válido",
      });
      return NextResponse.json({
        message: "Si el contacto coincide con un segundo contacto de confianza válido, se envió un código.",
      });
    }

    // v8.3 fix C-H9: antes esto ponía co_verification_attempts en 0 en CADA
    // llamada a "request", así que un atacante podía pedir un código nuevo
    // cada vez que se le acababan los MAX_VERIFICATION_ATTEMPTS del anterior
    // -- fuerza bruta sin techo real sobre el código corto. Ahora el
    // contador solo se reinicia si no había código vigente (primera vez) o
    // si el código anterior ya expiró; si el código anterior sigue vigente
    // y ya se agotaron los intentos, se rechaza la petición de uno nuevo en
    // vez de regalar un presupuesto de intentos fresco.
    const hadPriorCode = Boolean(reqRow.co_verification_code_hash);
    const priorCodeStillValid = hadPriorCode && !isExpired(reqRow.co_verification_code_expires_at);

    if (priorCodeStillValid && reqRow.co_verification_attempts >= MAX_VERIFICATION_ATTEMPTS) {
      await logRecoveryAuditEvent(serviceClient, {
        requestId: reqRow.id,
        eventType: "co_verification_failed",
        actorType: "successor",
        detail: "Nuevo código de co-verificación denegado: código vigente ya agotó sus intentos",
      });
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }

    const code = generateVerificationCode();
    const { error: updateError } = await serviceClient
      .from("access_recovery_requests")
      .update({
        co_verifier_successor_id: successor.id,
        co_verification_code_hash: hashVerificationCode(code),
        co_verification_code_expires_at: verificationCodeExpiryIso(),
        co_verification_attempts: priorCodeStillValid ? reqRow.co_verification_attempts : 0,
      })
      .eq("id", reqRow.id)
      .eq("status", "verified_pending_approval");

    if (updateError) {
      console.error("[recovery/co-verify request] update error:", updateError.message);
      return NextResponse.json({ error: "Could not start co-verification" }, { status: 500 });
    }

    const rendered =
      (await renderCatalogTemplate(serviceClient, "access_recovery_verification_code", {
        code,
        reason: `Aprobación de solicitud de recuperación de acceso: ${reqRow.reason}`,
      })) ?? `Lulu Island Flagship: tu código de aprobación es ${code} (vence en 15 minutos).`;

    const sendResult = await sendToSuccessor(successor, rendered);
    await logRecoveryAuditEvent(serviceClient, {
      requestId: reqRow.id,
      eventType: "co_verification_code_sent",
      actorType: "system",
      actorRef: maskSuccessorContact(successor),
      detail: `Canal: ${sendResult.channel}, estado: ${sendResult.status}`,
    });

    return NextResponse.json({
      message: "Si el contacto coincide con un segundo contacto de confianza válido, se envió un código.",
    });
  }

  if (body.action === "confirm") {
    if (!body.code || typeof body.code !== "string") {
      return NextResponse.json({ error: "code is required" }, { status: 400 });
    }
    if (!reqRow.co_verifier_successor_id || !reqRow.co_verification_code_hash) {
      return NextResponse.json({ error: "Co-verification was not started for this request" }, { status: 400 });
    }
    if (
      isExpired(reqRow.co_verification_code_expires_at) ||
      reqRow.co_verification_attempts >= MAX_VERIFICATION_ATTEMPTS
    ) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }

    const codeHash = hashVerificationCode(body.code);
    const { data: confirmed, error: confirmError } = await serviceClient
      .from("access_recovery_requests")
      .update({ co_verified_at: new Date().toISOString() })
      .eq("id", reqRow.id)
      .eq("status", "verified_pending_approval")
      .eq("co_verification_code_hash", codeHash)
      .select("id, successor_id, co_verifier_successor_id, reason")
      .maybeSingle();

    if (confirmError) {
      console.error("[recovery/co-verify confirm] update error:", confirmError.message);
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }

    if (!confirmed) {
      await serviceClient
        .from("access_recovery_requests")
        .update({ co_verification_attempts: reqRow.co_verification_attempts + 1 })
        .eq("id", reqRow.id);
      await logRecoveryAuditEvent(serviceClient, {
        requestId: reqRow.id,
        eventType: "co_verification_failed",
        actorType: "successor",
        detail: `Intento ${reqRow.co_verification_attempts + 1}/${MAX_VERIFICATION_ATTEMPTS}`,
      });
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }

    await logRecoveryAuditEvent(serviceClient, {
      requestId: confirmed.id,
      eventType: "co_verification_succeeded",
      actorType: "successor",
    });

    // La doble verificación de 2 contactos distintos ES la aprobación humana
    // requerida (paso 5) -- ningún admin adicional necesario. Resuelve y
    // emite el código de emergencia inmediatamente.
    //
    // Migración 323: la transición de estado 'verified_pending_approval' ->
    // 'approved' se reclama atómicamente vía claim_access_recovery_approval_atomic
    // (CAS sobre status) ANTES de emitir ningún código de emergencia -- esta
    // ruta y POST /api/admin/access-recovery (action=approve) pueden competir
    // por la misma solicitud (un admin logueado aprobando casi al mismo
    // tiempo que un segundo successor confirma su código), y solo la que
    // gana el CAS debe emitir códigos. La otra ve REQUEST_ALREADY_RESOLVED y
    // no emite un segundo juego de códigos.
    const { error: claimError } = await serviceClient
      .rpc("claim_access_recovery_approval_atomic", {
        p_request_id: confirmed.id,
        p_resolved_by: "successor_co_verification",
        p_resolved_by_admin_user_id: null,
        p_resolved_by_successor_id: confirmed.co_verifier_successor_id,
      })
      .single();

    if (claimError) {
      if (claimError.message?.includes("REQUEST_ALREADY_RESOLVED")) {
        // Ya fue aprobada por la otra vía (un admin logueado) una fracción
        // de segundo antes -- el código de verificación de este successor
        // era correcto, pero no hay nada más que hacer: no se emite un
        // segundo juego de códigos de emergencia.
        return NextResponse.json({
          status: "approved",
          message: "Solicitud ya fue aprobada por un administrador. No se emitió un código adicional.",
        });
      }
      console.error("[recovery/co-verify confirm] claim error:", claimError.message);
      return NextResponse.json({ error: "Verification failed" }, { status: 500 });
    }

    const owners = await getActiveOwnerAdmins(serviceClient);
    if (owners.length === 0) {
      // No debería pasar en un sistema configurado correctamente, pero si
      // pasa, NO se emite ningún código -- la solicitud ya quedó 'approved'
      // por el CAS de arriba, y queda rastro para investigación manual en
      // vez de fallar silenciosamente o inventar un destinatario.
      await logRecoveryAuditEvent(serviceClient, {
        requestId: confirmed.id,
        eventType: "admin_approved",
        actorType: "successor",
        detail: "Aprobado por doble verificación, pero NO se encontró ningún owner_admin activo -- código de emergencia no emitido",
      });
      return NextResponse.json({
        status: "approved",
        warning: "No active owner_admin account found. Contact support to complete recovery.",
      });
    }

    const issuedCodes = await issueEmergencyAccessCodes(serviceClient);

    await logRecoveryAuditEvent(serviceClient, {
      requestId: confirmed.id,
      eventType: "emergency_code_issued",
      actorType: "system",
      detail: `${issuedCodes.length} código(s) de emergencia emitido(s) para owner_admin(s) activos`,
    });

    // Se envía el código al successor que INICIÓ la solicitud (no al
    // co-verificador) -- es quien va a estar en contacto con el manager
    // para relayárselo de forma segura.
    const successors = await serviceClient
      .from("trusted_successors")
      .select("id, name, contact_phone, contact_email, is_active")
      .eq("id", confirmed.successor_id)
      .maybeSingle();
    if (successors.data && issuedCodes[0]) {
      const rendered =
        (await renderCatalogTemplate(serviceClient, "access_recovery_emergency_code_issued", {
          code: issuedCodes[0].code,
        })) ?? `Lulu Island Flagship: código de emergencia de un solo uso: ${issuedCodes[0].code} (expira en 1 hora).`;
      await sendToSuccessor(successors.data, rendered);
    }

    return NextResponse.json({
      status: "approved",
      message: "Solicitud aprobada por doble verificación. El código de emergencia fue enviado al solicitante original.",
    });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}

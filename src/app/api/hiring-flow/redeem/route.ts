import { NextRequest, NextResponse } from "next/server";
import { hashCode } from "@/lib/hiring-flow/access-code-service";
import { markAccessCodeUsed } from "@/lib/hiring-flow/access-code-service";
import { createSession } from "@/lib/hiring-flow/session-service";
import { checkRateLimit } from "@/lib/hiring-flow/rate-limiter";
import { safeErrorResponse } from "@/lib/api-errors";

// POST /api/hiring-flow/redeem — punto de entrada público (sin auth) para
// que el candidato pueda canjear el código de acceso de 8 caracteres que
// recibió por SMS/email tras completar el Paso 1 vía
// POST /api/hiring-flow/apply. Es el eslabón faltante del flujo: sin esta
// ruta, el código generado y enviado en apply/route.ts no tenía ningún
// lugar donde el candidato pudiera ingresarlo para continuar su aplicación.
//
// Flujo:
//   1. El frontend (página de "continuar aplicación") le pide al candidato
//      que ingrese el código de 8 caracteres que recibió.
//   2. POST /api/hiring-flow/redeem { code: "ABC23XYZ" }
//   3. Esta ruta hashea el código, busca en access_codes por code_hash,
//      valida que no esté usado ni expirado, lo marca como usado, crea una
//      sesión para el candidato y devuelve candidateId + sessionToken.
//   4. El frontend guarda el sessionToken (cookie httpOnly o sessionStorage)
//      y redirige al candidato al siguiente paso del flujo.
//
// Rate-limited por IP (mismo patrón que apply/route.ts) usando el setting
// hiring_flow_apply_ip_max_requests como límite compartido.

function extractIpAddress(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  // --- Parse body ---
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const rawCode = typeof body.code === "string" ? body.code.trim() : "";
  if (rawCode.length === 0) {
    return NextResponse.json(
      { error: "Access code is required" },
      { status: 400 }
    );
  }

  // --- Rate limit by IP ---
  const ipAddress = extractIpAddress(request);
  const { allowed: ipAllowed } = await checkRateLimit(
    `redeem:ip:${ipAddress}`,
    "hiring_flow_redeem_ip_max_requests"
  );
  if (!ipAllowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  try {
    // --- Dynamic imports (avoids top-level side-effects) ---
    const { getHiringFlowServiceClient } = await import(
      "@/lib/hiring-flow/settings-service"
    );
    const client = getHiringFlowServiceClient();
    if (!client) {
      return NextResponse.json(
        { error: "Service temporarily unavailable. Please try again later." },
        { status: 503 }
      );
    }

    const codeHash = hashCode(rawCode);

    // Buscar el access_code por hash (sin candidateId — el candidato solo
    // conoce el código, no su UUID interno). Se usa .maybeSingle() para
    // manejar el caso de que no exista sin que Supabase lance error.
    const { data: row, error: queryError } = await client
      .from("access_codes")
      .select("id, candidate_id, purpose, expires_at, used_at")
      .eq("code_hash", codeHash)
      .maybeSingle();

    if (queryError) {
      console.error("[hiring-flow/redeem] Query error:", queryError);
      return safeErrorResponse(queryError, 500, "Internal server error");
    }

    if (!row) {
      return NextResponse.json(
        { error: "invalid_code", message: "The access code is not valid." },
        { status: 400 }
      );
    }

    // Chequear si ya fue usado
    if (row.used_at !== null) {
      return NextResponse.json(
        { error: "code_already_used", message: "This access code has already been used." },
        { status: 400 }
      );
    }

    // Chequear expiración
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "code_expired", message: "This access code has expired. Please apply again." },
        { status: 400 }
      );
    }

    const candidateId = row.candidate_id as string;

    // --- Crear sesión para el candidato (ANTES de marcar el código) ---
    // Orden deliberado: si createSession falla, el código sigue sin usar y
    // el candidato puede reintentar. Si marcáramos el código primero y
    // createSession fallara después, el candidato quedaría bloqueado
    // permanentemente (código marcado como usado, sin sesión).
    const { rawToken, expiresAt } = await createSession(candidateId, client);

    // --- Marcar el código como usado ---
    // Si esto falla, invalidamos la sesión que acabamos de crear para
    // mantener el invariante de un solo uso: es preferible que el candidato
    // tenga que reintentar (el código sigue sin usar) a que exista una
    // sesión válida con un código que otro podría reutilizar.
    try {
      await markAccessCodeUsed(row.id as string, client);
    } catch (markError) {
      console.error(
        `[hiring-flow/redeem] Failed to mark code ${row.id} as used for candidate ${candidateId}. ` +
          `Invalidating newly created session as compensation.`,
        markError
      );
      // Compensación: invalidar la sesión que creamos
      try {
        await client
          .from("sessions")
          .update({ invalidated_at: new Date().toISOString() })
          .eq("candidate_id", candidateId)
          .eq("token_hash", hashCode(rawToken));
      } catch (invalidateError) {
        console.error(
          "[hiring-flow/redeem] Compensation also failed — session may be leaked:",
          invalidateError
        );
      }
      return safeErrorResponse(
        markError,
        500,
        "Internal server error"
      );
    }

    // --- Obtener datos del candidato para el frontend ---
    const { data: candidateRow, error: candidateError } = await client
      .from("candidates")
      .select("id, first_name, last_name, email, status")
      .eq("id", candidateId)
      .single();

    if (candidateError || !candidateRow) {
      console.error("[hiring-flow/redeem] Candidate fetch error:", candidateError);
      return safeErrorResponse(
        candidateError ?? new Error("Candidate not found"),
        500,
        "Internal server error"
      );
    }

    console.log(
      `[hiring-flow/redeem] Code redeemed for candidate ${candidateId}: ` +
        `purpose=${row.purpose} session_expires=${expiresAt.toISOString()}`
    );

    return NextResponse.json(
      {
        success: true,
        candidate: {
          id: candidateRow.id,
          firstName: candidateRow.first_name,
          lastName: candidateRow.last_name,
          email: candidateRow.email,
          status: candidateRow.status,
        },
        session: {
          token: rawToken,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    return safeErrorResponse(error, 500, "Internal server error");
  }
}

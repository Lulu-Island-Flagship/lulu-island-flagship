import { NextRequest, NextResponse } from "next/server";
import {
  submitStep1Application,
  Step1SubmissionError,
  ConsentRequiredError,
} from "@/lib/hiring-flow/candidate-step1-service";
import { PositionNotFoundError } from "@/lib/hiring-flow/positions-service";
import type { Step1Input } from "@/lib/hiring-flow/step1-validator";
import { safeErrorResponse } from "@/lib/api-errors";

// POST /api/hiring-flow/apply — punto de entrada público (sin auth) para el
// Paso 1 del flujo de contratación de candidatos ("empleo" en el sitio
// público). Orquesta todo el trabajo real vía
// src/lib/hiring-flow/candidate-step1-service.ts (submitStep1Application),
// que este archivo NO reimplementa ni edita -- ver instrucciones del
// módulo hiring-flow.
//
// positionSlug fijo "general": todavía no existe un selector público de
// vacantes (panel de administración de posiciones, fuera de este alcance),
// así que toda aplicación entrante desde /empleo se registra contra la
// única vacante pública sembrada por
// supabase/migrations/282_hiring_flow_seed_general_position.sql.

interface ApplyRequestBody {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  dateOfBirth?: unknown;
  consentAccepted?: unknown;
}

const GENERAL_POSITION_SLUG = "general";

function extractIpAddress(request: NextRequest): string {
  // Mismo patrón usado en src/app/api/recovery/request/route.ts: primer
  // valor de x-forwarded-for (el más cercano al cliente original detrás de
  // proxies/CDN), con fallback a x-real-ip y finalmente "unknown" si
  // ninguno de los dos headers está presente (ej. en entornos locales sin
  // proxy delante).
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  let body: ApplyRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const input: Step1Input = {
    firstName: typeof body.firstName === "string" ? body.firstName : "",
    lastName: typeof body.lastName === "string" ? body.lastName : "",
    email: typeof body.email === "string" ? body.email : "",
    phone: typeof body.phone === "string" ? body.phone : "",
    dateOfBirth: typeof body.dateOfBirth === "string" ? body.dateOfBirth : "",
  };
  const consentAccepted = body.consentAccepted === true;

  const ipAddress = extractIpAddress(request);
  const userAgent = request.headers.get("user-agent");

  try {
    const result = await submitStep1Application({
      positionSlug: GENERAL_POSITION_SLUG,
      input,
      ipAddress,
      userAgent,
      consentAccepted,
      client: undefined,
    });

    // Limitación temporal conocida: el envío real del código de acceso por
    // SMS/email (cola de mensajes / communications) todavía no existe para
    // este flujo -- queda fuera de este alcance. Mientras tanto, se
    // loguea server-side (nunca en la respuesta HTTP pública, que es
    // sensible) para que el equipo pueda comunicárselo al candidato
    // manualmente hasta que exista el envío automático real.
    console.log(
      `[hiring-flow/apply] Access code issued for candidate ${result.candidateId} ` +
        `(expires ${result.accessCodeExpiresAt.toISOString()}): ${result.accessCode}`
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof Step1SubmissionError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          validationErrors: error.validationErrors,
        },
        { status: 400 }
      );
    }

    if (error instanceof ConsentRequiredError) {
      return NextResponse.json(
        { error: "Consent is required to submit an application" },
        { status: 400 }
      );
    }

    if (error instanceof PositionNotFoundError) {
      // No se filtra el detalle real (slug/causa) -- mensaje genérico de
      // "aplicaciones temporalmente no disponibles", mismo criterio de
      // safeErrorResponse para el resto de errores inesperados.
      return safeErrorResponse(
        error,
        503,
        "Applications are temporarily unavailable. Please try again later."
      );
    }

    // Cualquier otro error inesperado: nunca exponer error.message crudo al
    // cliente (mismo patrón que AuthModal.tsx / safeErrorResponse en el
    // resto del repo) -- se loguea completo server-side y se devuelve un
    // mensaje genérico.
    return safeErrorResponse(error, 500, "Internal server error");
  }
}

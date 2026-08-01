import { NextRequest, NextResponse } from "next/server";
import {
  submitStep1Application,
  Step1SubmissionError,
  ConsentRequiredError,
} from "@/lib/hiring-flow/candidate-step1-service";
import { PositionNotFoundError } from "@/lib/hiring-flow/positions-service";
import type { Step1Input } from "@/lib/hiring-flow/step1-validator";
import { safeErrorResponse } from "@/lib/api-errors";
import { sendSms, isSmsProviderConfigured } from "@/lib/sms";
import { sendEmail } from "@/lib/email";

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

    // Envío real del código de acceso al Paso 2. Reusa los mismos
    // adaptadores ya en producción para el resto del sistema
    // (src/lib/sms.ts vía Twilio, src/lib/email.ts vía Resend) -- no se
    // reimplementa ningún cliente de proveedor nuevo aquí. Se prefiere SMS
    // (más inmediato para un candidato que está completando el formulario
    // en el momento) y se usa email como respaldo/complemento cuando hay
    // dirección disponible. El código en crudo NUNCA se loguea a partir de
    // este punto (antes se logueaba server-side como limitación temporal;
    // ver commit anterior) -- si ambos canales fallan o no están
    // configurados, el candidato simplemente no recibe el código todavía y
    // el dueño debe contratar un proveedor (TWILIO_*/RESEND_API_KEY) antes
    // de que este flujo sea utilizable en producción real. Esto es
    // consistente con la "regla de oro de seguridad" del resto del repo:
    // nunca se sustituye un envío real por un canal inseguro (loguear en
    // texto plano) cuando el proveedor no está disponible.
    const smsBody = `Tu código de acceso para continuar tu aplicación es: ${result.accessCode}. Vence en 30 minutos.`;
    let deliveryChannel: "sms" | "email" | "none" = "none";

    if (isSmsProviderConfigured() && input.phone) {
      const smsResult = await sendSms({ phoneNumber: input.phone, body: smsBody });
      if (smsResult.status === "sent" || smsResult.status === "queued") {
        deliveryChannel = "sms";
      }
    }

    if (deliveryChannel === "none" && input.email) {
      const emailResult = await sendEmail({
        toEmail: input.email,
        subject: "Tu código de acceso — aplicación de empleo",
        body: `Hola ${input.firstName},\n\nTu código de acceso para continuar tu aplicación es: ${result.accessCode}\n\nEste código vence en 30 minutos.\n\nLulu Island Flagship`,
      });
      if (emailResult.status === "sent" || emailResult.status === "queued") {
        deliveryChannel = "email";
      }
    }

    // Nunca se incluye el código en la respuesta HTTP pública (sensible).
    // Solo se registra, server-side, si se pudo entregar y por qué canal --
    // sin el valor del código -- para que el equipo tenga visibilidad
    // operativa sin reintroducir el riesgo de loguear el secreto.
    console.log(
      `[hiring-flow/apply] Access code delivery for candidate ${result.candidateId}: ` +
        `channel=${deliveryChannel} expires=${result.accessCodeExpiresAt.toISOString()}`
    );

    // Fix (auditoría externa, hallazgo confirmado): si tanto SMS como email
    // fallan (o ninguno de los dos estaba configurado / el candidato no dejó
    // ni teléfono ni email utilizable), antes esto igual respondía
    // { success: true } -- el candidato veía una pantalla de "revisa tu
    // teléfono/correo" sin que nadie le fuera a enviar nada nunca, sin forma
    // de saber que algo salió mal. El candidato (con su consentimiento
    // registrado) y el código de acceso YA existen en la base para este
    // punto -- candidate-step1-service.ts los crea de forma atómica antes de
    // que este endpoint intente la entrega, y revertir esa creación acá
    // reabriría la ventana de "candidato sin consentimiento" que la RPC 268
    // fue diseñada para cerrar (ver nota de atomicidad en ese archivo). Así
    // que en vez de deshacer nada, simplemente dejamos de mentir sobre el
    // éxito: 503 explícito para que el frontend le diga al candidato que
    // intente de nuevo o contacte a la empresa, en vez de fingir que ya
    // recibirá su código.
    if (deliveryChannel === "none") {
      return NextResponse.json(
        {
          success: false,
          error:
            "We couldn't send your access code by SMS or email. Please try again in a few minutes or contact us directly.",
        },
        { status: 503 }
      );
    }

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

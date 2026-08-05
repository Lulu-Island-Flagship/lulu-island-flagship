import { NextRequest, NextResponse } from "next/server";
import {
  submitStep1Application,
  Step1SubmissionError,
  ConsentRequiredError,
  DuplicateApplicationError,
  LegalTextVersionMismatchError,
} from "@/lib/hiring-flow/candidate-step1-service";
import { PositionNotFoundError } from "@/lib/hiring-flow/positions-service";
import type { Step1Input } from "@/lib/hiring-flow/step1-validator";
import { safeErrorResponse } from "@/lib/api-errors";
import { checkRateLimit } from "@/lib/hiring-flow/rate-limiter";
import { createClient } from "@supabase/supabase-js";
import { sendSms, isSmsProviderConfigured } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { locales, defaultLocale, type Locale } from "@/i18n/config";

// Fix (auditoría externa 2026-08-02, hallazgo MEDIO #3): el SMS/email de
// confirmación de aplicación estaban hardcodeados en español sin importar
// el idioma del candidato. El frontend (JobApplicationForm.tsx) ahora
// manda su `locale` actual (de next-intl, useLocale()) en el body -- mismo
// patrón de "el locale lo determina quien ya lo tiene resuelto en el
// request" usado en telephony-router.ts (AccountLocale por registro), pero
// acá no hay cuenta/registro previo del candidato, así que se toma del
// contexto de la página que envía el formulario. Fallback a defaultLocale
// ('en') si no viene o no es uno de los locales soportados.
const APPLY_SMS_BODY: Record<Locale, (accessCode: string) => string> = {
  en: (accessCode) =>
    `Thank you for applying to Lulu Island Flagship. Your reference code is: ${accessCode}. Our HR team will review your application and get in touch with you.`,
  fr: (accessCode) =>
    `Merci d'avoir postulé chez Lulu Island Flagship. Votre code de référence est : ${accessCode}. Notre équipe RH examinera votre candidature et vous contactera.`,
  zh: (accessCode) =>
    `感谢您申请 Lulu Island Flagship 的职位。您的参考代码是：${accessCode}。我们的人力资源团队将审核您的申请并与您联系。`,
};

const APPLY_EMAIL_SUBJECT: Record<Locale, string> = {
  en: "We've received your application — Lulu Island Flagship",
  fr: "Nous avons bien reçu votre candidature — Lulu Island Flagship",
  zh: "我们已收到您的申请 — Lulu Island Flagship",
};

const APPLY_EMAIL_BODY: Record<Locale, (firstName: string, accessCode: string) => string> = {
  en: (firstName, accessCode) =>
    `Hi ${firstName},\n\nThank you for applying to Lulu Island Flagship. Your reference code is: ${accessCode}\n\nOur HR team will review your application and get in touch with you about next steps.\n\nLulu Island Flagship`,
  fr: (firstName, accessCode) =>
    `Bonjour ${firstName},\n\nMerci d'avoir postulé chez Lulu Island Flagship. Votre code de référence est : ${accessCode}\n\nNotre équipe RH examinera votre candidature et vous contactera au sujet des prochaines étapes.\n\nLulu Island Flagship`,
  zh: (firstName, accessCode) =>
    `您好 ${firstName}，\n\n感谢您申请 Lulu Island Flagship 的职位。您的参考代码是：${accessCode}\n\n我们的人力资源团队将审核您的申请，并就后续步骤与您联系。\n\nLulu Island Flagship`,
};

function resolveLocale(value: unknown): Locale {
  if (typeof value === "string" && (locales as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return defaultLocale;
}

// Fix (auditoría externa 2026-08-08, Kimi): el código de acceso generado y
// enviado por SMS/email en este endpoint NO tenía ningún lugar donde el
// candidato pudiera canjearlo para continuar su aplicación. Se creó
// POST /api/hiring-flow/redeem (src/app/api/hiring-flow/redeem/route.ts)
// como el endpoint de canje. El frontend debe redirigir al candidato a una
// página donde ingrese el código, que luego llama a /api/hiring-flow/redeem.
//
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
  // Fix (auditoría externa, hallazgo CRÍTICO #2): versión del texto legal
  // ("pipa_step1") que el candidato efectivamente vio y aceptó, obtenida
  // por el frontend de GET /api/hiring-flow/legal-text. Ver
  // LegalTextVersionMismatchError en candidate-step1-service.ts.
  legalTextVersion?: unknown;
  // Fix (auditoría externa, hallazgo MEDIO #3): locale actual del
  // candidato (next-intl useLocale() en el frontend), para localizar el
  // SMS/email de confirmación.
  locale?: unknown;
  // CV / resume upload: storage path returned by POST /api/hiring-flow/upload-resume
  resumeStoragePath?: unknown;
  resumeMimeType?: unknown;
  resumeSizeBytes?: unknown;
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
  const expectedLegalTextVersion =
    typeof body.legalTextVersion === "string" && body.legalTextVersion.length > 0
      ? body.legalTextVersion
      : undefined;
  const locale = resolveLocale(body.locale);
  const resumeStoragePath =
    typeof body.resumeStoragePath === "string" && body.resumeStoragePath.length > 0
      ? body.resumeStoragePath
      : null;
  const resumeMimeType =
    typeof body.resumeMimeType === "string" && body.resumeMimeType.length > 0
      ? body.resumeMimeType
      : null;
  const resumeSizeBytes =
    typeof body.resumeSizeBytes === "number" && body.resumeSizeBytes > 0
      ? body.resumeSizeBytes
      : null;

  const ipAddress = extractIpAddress(request);
  const userAgent = request.headers.get("user-agent");

  // Rate limit por IP (auditoría 2026-08-01 §5 diferido 4).
  const { allowed: ipAllowed } = await checkRateLimit(
    `apply:ip:${ipAddress}`,
    "hiring_flow_apply_ip_max_requests"
  );
  if (!ipAllowed) {
    return NextResponse.json(
      { error: "Demasiadas solicitudes. Intenta de nuevo más tarde." },
      { status: 429 }
    );
  }

  try {
    const result = await submitStep1Application({
      positionSlug: GENERAL_POSITION_SLUG,
      input,
      ipAddress,
      userAgent,
      consentAccepted,
      expectedLegalTextVersion,
      client: undefined,
    });

    // Si el candidato subió un CV/resume, crear el registro en la tabla
    // `documents` vinculado al candidate_id recién creado. El archivo ya
    // fue validado y guardado en Storage por POST /api/hiring-flow/upload-resume.
    if (resumeStoragePath && resumeMimeType && resumeSizeBytes) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.SUPABASE_SERVICE_ROLE_KEY || ""
      );
      const { error: docError } = await supabase.from("documents").insert({
        candidate_id: result.candidateId,
        document_type: "resume",
        storage_path: resumeStoragePath,
        mime_type: resumeMimeType,
        size_bytes: resumeSizeBytes,
      });
      if (docError) {
        console.error(
          `[hiring-flow/apply] Failed to link resume document for candidate ${result.candidateId}:`,
          docError.message
        );
        // No revertimos la aplicación -- el candidato ya fue creado con
        // consentimiento atómico (RPC submit_step1_candidate). El archivo
        // sigue en Storage y se puede vincular manualmente.
      }
    }

    // Envío del código de acceso, generado y persistido por
    // candidate-step1-service.ts (para cuando exista una pantalla web de
    // canje -- ver access-code-service.ts/session-service.ts, ya
    // implementados pero sin ninguna ruta en src/app que los invoque).
    //
    // Fix (auditoría CI/build/config 2026-08-01, hallazgo "flujo huérfano
    // /empleo"): el texto anterior le decía al candidato "tu código de
    // acceso para continuar tu aplicación", implicando que existía una
    // pantalla donde canjearlo -- no existe ninguna (confirmado: no hay
    // ruta bajo src/app que use access-code-service.ts o session-service.ts
    // para candidatos). Un candidato real recibía un código de 6 dígitos
    // que vencía en 30 minutos sin ningún lugar donde usarlo. Se sigue
    // enviando el código (se conserva por si RRHH lo pide por teléfono
    // mientras no exista la UI de los Pasos 2-5, y para no tocar la lógica
    // de generación/expiración ya implementada y testeada), pero el texto ya
    // no promete una continuación de autoservicio que no existe.
    const smsBody = APPLY_SMS_BODY[locale](result.accessCode);
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
        subject: APPLY_EMAIL_SUBJECT[locale],
        body: APPLY_EMAIL_BODY[locale](input.firstName, result.accessCode),
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

    // Fix (auditoría externa, hallazgo CRÍTICO #2): la versión del texto
    // legal que el candidato aceptó (mostrada por
    // GET /api/hiring-flow/legal-text) ya no coincide con la versión
    // activa real al momento del submit -- ver
    // LegalTextVersionMismatchError. 409 (conflicto de estado, no error
    // inesperado del servidor) con un código estable para que el frontend
    // pueda recargar el texto legal y pedirle al candidato que vuelva a
    // aceptar.
    if (error instanceof LegalTextVersionMismatchError) {
      console.error("error:", error);
      return NextResponse.json({ error: "legal_text_outdated" }, { status: 409 });
    }

    // Fix (auditoría externa, hallazgo confirmado): antes no había ninguna
    // verificación de duplicados -- ver DuplicateApplicationError y la
    // migración 297_hiring_flow_candidates_dedup_unique_index.sql. 409 en
    // vez de 500 porque esto no es un error inesperado del servidor, es un
    // conflicto legítimo con el estado actual de los datos (ya existe una
    // aplicación activa para este email/teléfono).
    //
    // Fix (auditoría externa 2026-08-02, hallazgo MEDIO #4): el body de
    // este 409 devolvía el mismo mensaje genérico "Ocurrió un error
    // interno" que safeErrorResponse usa para errores 500 inesperados
    // (fix de una ronda de auditoría anterior que oculta detalle interno
    // sensible) -- eso hacía que el frontend no pudiera distinguir "ya
    // aplicaste antes" de un error real de servidor, y el candidato veía
    // un mensaje que no explicaba nada ni le decía qué hacer. El código
    // "duplicate_application" SÍ es seguro de exponer (no es información
    // interna del servidor, es un hecho sobre el propio request del
    // candidato) -- se devuelve como campo `error` estable para que el
    // frontend lo reconozca y muestre un mensaje localizado específico.
    if (error instanceof DuplicateApplicationError) {
      console.error("error:", error);
      return NextResponse.json({ error: "duplicate_application" }, { status: 409 });
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

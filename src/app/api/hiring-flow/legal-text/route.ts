import { NextRequest, NextResponse } from "next/server";
import {
  renderLegalText,
  LegalTextNotFoundError,
  PlaceholderLegalTextError,
} from "@/lib/hiring-flow/legal-text-service";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/hiring-flow/legal-text?key=pipa_step1 — endpoint público (sin
// auth) que sirve el texto legal ACTIVO real para el flujo público de
// aplicación a empleo, para que el frontend (JobApplicationForm.tsx) pueda
// mostrarle al candidato el texto legal de verdad -- no un string
// hardcodeado -- antes de que acepte el consentimiento, y para que el
// candidato pueda enviar de vuelta la versión exacta que se le mostró
// (ver ConsentRequiredError / legalTextVersion en
// candidate-step1-service.ts).
//
// Fix (auditoría externa 2026-08-02, hallazgo CRÍTICO #2): antes el
// formulario de aplicación a empleo solo mostraba un string i18n
// hardcodeado (`empleo.fields.consentLabel`), sin enlace al texto legal
// real ni a /privacidad, y sin que el backend supiera qué versión se le
// mostró al candidato.
//
// Allow-list explícita de `key`: este endpoint es público y sin auth, así
// que no debe poder usarse como oráculo genérico sobre la tabla
// legal_texts completa (ej. para enumerar keys internas del módulo de
// cliente). Solo se expone lo que el flujo público de empleo necesita.
const ALLOWED_PUBLIC_KEYS = new Set(["pipa_step1"]);

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");

  if (!key || !ALLOWED_PUBLIC_KEYS.has(key)) {
    return NextResponse.json({ error: "Unknown or unsupported legal text key" }, { status: 400 });
  }

  try {
    const { text, version } = await renderLegalText(key);
    return NextResponse.json({ key, version, text }, { status: 200 });
  } catch (error) {
    if (error instanceof LegalTextNotFoundError || error instanceof PlaceholderLegalTextError) {
      // No exponer el motivo interno exacto (reason / mensaje de
      // PlaceholderLegalTextError) al cliente público -- solo que el
      // texto no está disponible ahora mismo. El detalle completo se
      // loguea server-side vía safeErrorResponse.
      return safeErrorResponse(
        error,
        503,
        "This legal text is temporarily unavailable. Please try again later or contact us directly."
      );
    }
    return safeErrorResponse(error, 500, "Internal server error");
  }
}

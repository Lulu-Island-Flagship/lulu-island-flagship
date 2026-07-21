import { NextResponse } from "next/server";
import { isSmsProviderConfigured } from "@/lib/sms";

// GET /api/system/sms-status — v8.3 P0-2 (auditoría Fable5, 2026-07-19).
//
// Endpoint público de solo lectura (no expone ningún secreto -- solo un
// booleano) para que el CLIENTE (cotizador, checkout) sepa si debe exigir
// el paso de verificación telefónica obligatoria antes de dejar avanzar al
// usuario. TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN son variables de entorno de
// SERVIDOR -- el navegador no puede leerlas directo, así que necesita este
// endpoint para tomar la misma decisión que ya toma /api/stripe/confirm
// (única fuente de verdad: isSmsProviderConfigured() en src/lib/sms.ts).
//
// Sin esto, la UI (AuthModal en modo forcePhoneVerification, sin botón de
// cerrar) seguía bloqueando al 100% de los clientes aunque el servidor ya
// hubiera dejado de exigir phone_verified -- el gate condicional del
// backend no servía de nada si el frontend seguía atorando al usuario en un
// modal sin salida.
export async function GET() {
  return NextResponse.json({ configured: isSmsProviderConfigured() }, { status: 200 });
}

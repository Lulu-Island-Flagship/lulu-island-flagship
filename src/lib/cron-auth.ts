import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/**
 * Guard compartido para los endpoints /api/cron/*.
 *
 * Antes, 13 rutas de cron hacían `cronSecret !== process.env.CRON_SECRET`
 * sin verificar primero que CRON_SECRET estuviera configurado. Si la
 * variable de entorno faltaba (`undefined`) y el llamador tampoco mandaba
 * el header Authorization (también `undefined`), `undefined !== undefined`
 * es `false` -- el check "pasaba" y el cron corría sin ninguna
 * autenticación. Esta función centraliza el patrón correcto (ya usado en
 * la mayoría de las otras rutas de cron): primero valida que CRON_SECRET
 * exista (500 si no), y sólo entonces compara contra el header Bearer
 * recibido, con comparación en tiempo constante para evitar timing attacks.
 *
 * Uso:
 *   const authError = requireCronAuth(request);
 *   if (authError) return authError;
 */
export function requireCronAuth(request: NextRequest | Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const provided = authHeader?.replace("Bearer ", "");

  if (!provided || !safeEqual(provided, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/** Comparación en tiempo constante para strings de largo variable. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

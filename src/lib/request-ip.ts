import type { NextRequest } from "next/server";

/**
 * Fix (pentest 2026-08-02): 5 endpoints (recovery/request, recovery/verify,
 * recovery/co-verify, admin/backup-codes/verify, staff/resolve-login)
 * derivaban la IP para rate limiting leyendo
 * `x-forwarded-for`.split(",")[0] como PRIMERA fuente. En Vercel esa
 * cabecera la reenvía el edge, pero el primer valor de la lista es el que
 * el cliente mandó originalmente -- un atacante puede setear su propio
 * `X-Forwarded-For: 1.2.3.4` y el código anterior lo tomaba tal cual,
 * permitiendo rotar la IP "vista" por el rate limiter en cada request
 * (bypass total del límite).
 *
 * Vercel SÍ expone una cabecera que el cliente no puede falsificar:
 * `x-vercel-forwarded-for`, que el edge de Vercel sobrescribe siempre con
 * la IP real de conexión (ver https://vercel.com/docs/edge-network/headers#x-vercel-forwarded-for).
 * Se prioriza esa cabecera; `x-forwarded-for`/`x-real-ip` quedan solo como
 * fallback para entornos donde `x-vercel-forwarded-for` no existe (dev
 * local, `next start` fuera de Vercel) -- en esos casos no hay cliente
 * externo pudiendo spoofear la cabecera de un proxy que uno mismo controla,
 * pero tampoco hay garantía real, así que se documenta como "menos
 * confiable" y nunca se usa en producción real (Vercel).
 */
export function getClientIp(request: NextRequest): string {
  const vercelIp = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercelIp) return vercelIp;

  // Fallback menos confiable: solo aplica cuando x-vercel-forwarded-for no
  // está presente (fuera de la red de Vercel). x-forwarded-for es
  // spoofeable por el cliente en ese contexto, así que no debe tratarse
  // como una IP de confianza para nada más que un mejor esfuerzo.
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor;

  return request.headers.get("x-real-ip") || "unknown";
}

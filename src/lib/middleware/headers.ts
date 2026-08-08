import type { NextRequest, NextResponse } from "next/server";

/**
 * Inyecta el header `x-pathname` en la response para que los Server
 * Components (como `admin/layout.tsx`) puedan leer el pathname real del
 * request y detectar el locale correcto sin acceso directo a la URL.
 *
 * Este es el único lugar del pipeline con acceso simultáneo al
 * `NextRequest` y a la `NextResponse`.
 */
export function injectPathnameHeader(
  request: NextRequest,
  response: NextResponse,
): void {
  response.headers.set("x-pathname", request.nextUrl.pathname);
}

/**
 * Inyecta headers de observabilidad (Capa 0 — Communication Observability)
 * para que sistemas downstream puedan trazar qué objeto de negocio disparó
 * una comunicación, sin acoplar módulos.
 */
export function injectObservabilityHeaders(response: NextResponse): void {
  response.headers.set("X-Business-Context", "ready");
  response.headers.set("X-Emitted-By", "middleware");
}

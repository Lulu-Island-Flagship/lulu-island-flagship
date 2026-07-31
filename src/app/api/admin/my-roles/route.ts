import { NextRequest, NextResponse } from "next/server";
import { getCurrentAdminRoles } from "@/lib/admin";

/**
 * GET /api/admin/my-roles — v8.3 fix (auditoría 2026-07-30, item 5).
 *
 * Devuelve únicamente los admin_roles del usuario autenticado (sin datos de
 * terceros). Las páginas owner-only (seguridad, feature-flags, y similares)
 * son Client Components -- a diferencia de admin/layout.tsx (Server
 * Component, que ya calcula esto para AdminNav), no tienen forma de leer
 * los roles reales del usuario antes de intentar su propio fetch a una API
 * protegida. Sin este chequeo explícito, un no-owner ve loaders y luego un
 * 403 crudo de la API real en vez de un mensaje claro de "no tienes
 * acceso". Este endpoint es intencionalmente mínimo (no expone nada más
 * allá de los roles del propio usuario) para no duplicar lógica de negocio.
 */
export async function GET(_request: NextRequest) {
  const { user, roles } = await getCurrentAdminRoles();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ roles });
}

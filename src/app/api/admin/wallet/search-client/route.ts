import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/wallet/search-client?q=... — busca clientes por
 * nombre/email/teléfono para el panel de billetera (src/app/[locale]/admin/wallet).
 *
 * Fix B (auditoría 2026-07-24): la página de wallet exigía que el admin
 * pegara a mano un `auth.users.id` (UUID) sin ningún buscador, sin
 * confirmación antes de otorgar crédito y sin feedback claro tras la
 * transacción. Este endpoint es la pieza de backend que faltaba para
 * reemplazar el input de UUID crudo por un autocomplete de nombre/email.
 *
 * Recurso RBAC: 'finance' -- mismo recurso que /api/admin/wallet (otorgar
 * crédito es una decisión financiera; encontrar A QUIÉN otorgárselo es
 * parte del mismo flujo y no debe tener una superficie de permisos más
 * amplia que la propia concesión).
 *
 * Seguridad: `q` se interpola dentro de un patrón ILIKE ('%q%'). Los
 * caracteres especiales de LIKE/ILIKE (`%` y `_`) se escapan explícitamente
 * antes de armar el patrón para que un admin no pueda, por accidente o a
 * propósito, ampliar la búsqueda más allá de lo esperado (p.ej. buscar
 * literalmente "50%_off" no debe actuar como comodín).
 */

function escapeLikePattern(input: string): string {
  // Escapa los caracteres especiales de LIKE/ILIKE de Postgres: % _ y el
  // propio caracter de escape \. El orden importa: \ primero.
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  const q = (request.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ clients: [] }, { status: 200 });
  }

  const escaped = escapeLikePattern(q);
  const pattern = `%${escaped}%`;

  // Nota: se evita .or("full_name.ilike....,email.ilike....") porque el
  // filtro combinado de PostgREST se parsea a partir de una cadena separada
  // por comas -- si `q` contiene una coma, rompería el parseo del filtro (no
  // es una inyección SQL, PostgREST solo la interpretaría mal), así que se
  // hacen 3 búsquedas independientes y se combinan aquí en JS.
  const [byName, byEmail, byPhone] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, phone").ilike("full_name", pattern).limit(10),
    supabase.from("profiles").select("id, full_name, email, phone").ilike("email", pattern).limit(10),
    supabase.from("profiles").select("id, full_name, email, phone").ilike("phone", pattern).limit(10),
  ]);

  const firstError = byName.error || byEmail.error || byPhone.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  const merged = new Map<string, { userId: string; fullName: string | null; email: string | null; phone: string | null }>();
  for (const row of [...(byName.data || []), ...(byEmail.data || []), ...(byPhone.data || [])]) {
    merged.set(row.id, { userId: row.id, fullName: row.full_name, email: row.email, phone: row.phone });
  }

  return NextResponse.json(
    { clients: Array.from(merged.values()).slice(0, 10) },
    { status: 200 }
  );
}

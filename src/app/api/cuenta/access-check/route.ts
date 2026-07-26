import { NextResponse } from "next/server";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import { resolveStaffLogin } from "@/lib/staff-login";

/**
 * GET /api/cuenta/access-check
 *
 * Fix (auditoría de autenticación 2026-07-25/26, item 5): src/app/[locale]/
 * cuenta/layout.tsx (área de cliente) solo verificaba Boolean(data.user) --
 * cualquier cuenta autenticada, incluyendo un empleado o admin, veía el
 * layout de cliente (AuthModal + CuentaNav + páginas de /cuenta) igual que
 * un cliente real.
 *
 * cuenta/layout.tsx es un Client Component (usa el cliente anon de Supabase
 * desde el navegador) y no puede leer employees/admin_roles directamente --
 * esas tablas están protegidas por RLS justo para que un usuario recién
 * autenticado no pueda leer/auto-vincularse (ver comentario en
 * src/lib/staff-login.ts). Esta Route Handler reutiliza resolveStaffLogin()
 * -- la MISMA función que ya usa /api/staff/resolve-login para /portal y los
 * layouts de /empleado y /admin -- con un cliente service-role, en modo
 * exclusivamente de lectura desde el punto de vista de este endpoint (no
 * hace signOut ni nada destructivo si el usuario resulta ser staff; a
 * diferencia de /api/staff/resolve-login, aquí "no autorizado como staff" es
 * el caso NORMAL y esperado para un cliente real, no un error).
 */
export async function GET() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ isStaff: false }, { status: 200 });
  }

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    // Configuración de servidor incompleta -- no se puede verificar. Se
    // conserva el comportamiento previo a este fix (no bloquear al cliente)
    // en vez de fallar de forma disruptiva por un problema de config.
    return NextResponse.json({ isStaff: false }, { status: 200 });
  }

  const result = await resolveStaffLogin(serviceClient, user.id, user.email);
  return NextResponse.json({ isStaff: result.authorized === true });
}

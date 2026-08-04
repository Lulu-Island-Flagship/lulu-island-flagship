import { NextResponse } from "next/server";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import { resolveStaffLogin } from "@/lib/staff-login";

/**
 * GET /api/account/access-check
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
 *
 * Fix (auditoria 2026-07-31, hallazgo confirmado): este GET, "de solo
 * lectura" segun su propio nombre, llamaba a resolveStaffLogin() sin mas --
 * y esa funcion, en el paso 3 (primer login de empleado invitado por
 * coincidencia de email), ejecuta un UPDATE real sobre employees.user_id.
 * Resultado: visitar /cuenta (el portal de CLIENTE) con la cuenta de Google
 * de un empleado invitado-pero-nunca-reclamado bastaba para vincularlo como
 * empleado, sin que ese fuera el flujo de login de staff en absoluto. Se usa
 * el modo `readOnly: true` (ver src/lib/staff-login.ts) que devuelve el
 * mismo veredicto SIN mutar nada -- la vinculacion real de verdad sigue
 * ocurriendo unicamente en /api/staff/resolve-login (POST, parte explicita
 * del flujo de login de staff).
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
    // Fix (auditoria 2026-07-31, hallazgo confirmado): si falta
    // SUPABASE_SERVICE_ROLE_KEY no hay forma de verificar si este usuario es
    // staff -- devolver `isStaff: false` en ese caso fallaba "abierto":
    // cuenta/layout.tsx trataria a un empleado o admin real como cliente
    // normal y le mostraria el portal de cliente (AuthModal + CuentaNav),
    // justo el escenario que este endpoint existe para prevenir (ver
    // comentario de cabecera). Un problema de configuracion de servidor no
    // debe traducirse en una fuga de superficie de autorizacion: se falla
    // cerrado con 500 explicito para que el cliente lo trate como error de
    // verificacion, no como "confirmado: no es staff".
    console.error("access-check: SUPABASE_SERVICE_ROLE_KEY missing, failing closed");
    return NextResponse.json(
      { error: "Server configuration incomplete", isStaff: null },
      { status: 500 }
    );
  }

  const result = await resolveStaffLogin(serviceClient, user.id, user.email, { readOnly: true });
  return NextResponse.json({ isStaff: result.authorized === true });
}

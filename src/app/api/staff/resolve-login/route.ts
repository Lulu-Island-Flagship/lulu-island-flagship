import { NextResponse } from "next/server";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import {
  resolveStaffLogin,
  STAFF_UNAUTHORIZED_MESSAGE,
  STAFF_PENDING_ACTIVATION_MESSAGE,
  type StaffArea,
} from "@/lib/staff-login";

/**
 * POST /api/staff/resolve-login — punto único de autorización del Portal de
 * equipo (src/app/[locale]/portal/page.tsx). Se llama justo después de que
 * Google OAuth devuelve una sesión válida (ver /auth/callback), NUNCA antes.
 *
 * Nunca crea cuentas ni filas nuevas -- solo lee employees/admin_roles y, en
 * el único caso permitido (empleado invitado en su primer login real),
 * vincula employees.user_id (ver src/lib/staff-login.ts). Si el email/user_id
 * no está registrado en NINGUNA de las dos tablas, se rechaza el login y se
 * cierra la sesión (auth.signOut()) para no dejar una sesión "a medias".
 */
const AREA_TO_PATH: Record<StaffArea, string> = {
  empleado: "/empleado",
  admin: "/admin",
  qc: "/admin/qc",
};

export async function POST() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No hay sesión activa." }, { status: 401 });
  }

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Configuración de servidor incompleta (SUPABASE_SERVICE_ROLE_KEY)." },
      { status: 500 }
    );
  }

  const result = await resolveStaffLogin(serviceClient, user.id, user.email);

  if (!result.authorized) {
    // Nunca dejar una sesión Supabase viva para una cuenta no autorizada.
    await supabase.auth.signOut();
    const message =
      result.reason === "pending_activation" ? STAFF_PENDING_ACTIVATION_MESSAGE : STAFF_UNAUTHORIZED_MESSAGE;
    return NextResponse.json({ error: message }, { status: 403 });
  }

  return NextResponse.json({
    path: AREA_TO_PATH[result.area],
    employeeLinkedNow: result.employeeLinkedNow,
  });
}

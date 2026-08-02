import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, getSupabaseClient } from "@/lib/admin";
import {
  resolveStaffLogin,
  STAFF_UNAUTHORIZED_MESSAGE,
  STAFF_PENDING_ACTIVATION_MESSAGE,
  type StaffArea,
} from "@/lib/staff-login";
import { getClientIp } from "@/lib/request-ip";

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

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // (el rate limit de abajo requiere serviceClient, así que ese chequeo
    // corre después de este 401 -- perfectamente aceptable: sin sesión
    // Supabase válida ya no hay forma de llegar a resolveStaffLogin, que es
    // la parte costosa de este endpoint).
    // Fix (auditoría externa, hallazgo confirmado): antes este texto y los
    // dos de abajo (server config / not_registered / pending_activation)
    // estaban quemados en español sin pasar por next-intl -- un cliente en
    // /fr/portal o /zh/portal los veía igual, en español, sin importar su
    // locale. Se agrega `reason` (código estable, no texto) para que el
    // cliente (src/app/[locale]/portal/page.tsx) elija el mensaje localizado
    // correcto vía t(`errors.${reason}`); `error` se conserva solo como
    // mejor-esfuerzo para quien consuma esta API sin pasar por esa pantalla.
    return NextResponse.json({ error: "No hay sesión activa.", reason: "no_session" }, { status: 401 });
  }

  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json(
      { error: "Configuración de servidor incompleta (SUPABASE_SERVICE_ROLE_KEY).", reason: "server_config_error" },
      { status: 500 }
    );
  }

  // Fix (auditoría 2026-07-31, hallazgo confirmado): este endpoint solo exige
  // sesión Supabase válida (línea 29) -- CUALQUIERA con cuenta de Google puede
  // autenticarse y llamarlo, no solo staff (el rechazo por no estar en
  // employees/admin_roles pasa DENTRO de resolveStaffLogin). Sin límite, un
  // atacante con una sola cuenta de Google podía golpear resolveStaffLogin en
  // loop -- mismo RPC check_rate_limit ya usado en
  // src/app/api/admin/backup-codes/verify/route.ts y src/app/api/quote/route.ts.
  const ip = getClientIp(request);
  const { data: rateLimitData, error: rateLimitError } = await serviceClient.rpc("check_rate_limit", {
    p_ip_address: `staff-resolve-login:${ip}`,
    p_max_requests: 20,
  });
  // Fix (auditoría externa, hallazgo CRÍTICO): antes, si el RPC fallaba
  // (error de red, timeout de BD), `error` se ignoraba y el código seguía
  // como si no hubiera límite -- fuerza bruta sin restricción en un fallo de
  // infraestructura. Ahora se falla CERRADO: si el RPC no responde, se
  // rechaza la petición en vez de dejarla pasar.
  if (rateLimitError) {
    console.error("[staff/resolve-login] check_rate_limit error:", rateLimitError.message);
    return NextResponse.json(
      { error: "Service temporarily unavailable. Try again later.", reason: "rate_limit_unavailable" },
      { status: 503 }
    );
  }
  if (rateLimitData && rateLimitData[0]?.allowed === false) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later.", reason: "rate_limited" },
      { status: 429 }
    );
  }

  const result = await resolveStaffLogin(serviceClient, user.id, user.email);

  if (!result.authorized) {
    // Nunca dejar una sesión Supabase viva para una cuenta no autorizada.
    await supabase.auth.signOut();
    const message =
      result.reason === "pending_activation" ? STAFF_PENDING_ACTIVATION_MESSAGE : STAFF_UNAUTHORIZED_MESSAGE;
    return NextResponse.json({ error: message, reason: result.reason }, { status: 403 });
  }

  return NextResponse.json({
    path: AREA_TO_PATH[result.area],
    employeeLinkedNow: result.employeeLinkedNow,
  });
}

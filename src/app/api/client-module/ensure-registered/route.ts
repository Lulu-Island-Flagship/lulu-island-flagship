
import { NextResponse } from "next/server";
import { ensureClientForAuthUser } from "@/lib/client-module/client-service";
import { getServiceRoleClient } from "@/lib/admin";
import { resolveStaffLogin } from "@/lib/staff-login";
import { createRouteSupabaseClient } from "@/lib/supabase-server";

// Fix (auditoría 2026-07-31, hallazgo confirmado): mismo criterio que
// src/lib/admin.ts -- throw en tiempo de ejecución (dentro de las funciones
// de abajo), nunca a nivel de módulo, para no arriesgar el build estático.
function _getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

function _getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
}

// Mismo patrón exacto que createRouteSupabaseClient() en src/lib/admin.ts: cliente
// anon + cookies de la request vía @supabase/ssr, para leer la sesión ya
// establecida por el flujo de auth existente (AuthModal.tsx / auth/callback
// route.ts) SIN tocar ni reimplementar esa lógica -- este endpoint solo
// LEE el usuario ya autenticado, nunca inicia ni modifica sesión.
// Endpoint puramente aditivo: vincula (o crea) la fila de `clients`
// correspondiente al usuario ya autenticado por el flujo existente. Nunca
// falla ruidosamente -- si no hay sesión, simplemente no hay nada que
// adjuntar (401 silencioso, no un error de servidor). Se llama desde
// EnsureClientRegistration.tsx tras SIGNED_IN, en segundo plano, sin
// impacto en el flujo de login/checkout ya en producción.
export async function POST() {
  const supabase = createRouteSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fix (auditoría 2026-07-31, hallazgo confirmado): este endpoint se llama
  // en segundo plano tras CUALQUIER SIGNED_IN (ver
  // EnsureClientRegistration.tsx), incluyendo el login de un admin/empleado
  // en /portal -- que también establece una sesión de Supabase Auth normal.
  // Sin este chequeo, cada login de staff creaba/vinculaba una fila en
  // `clients`, contaminando el CRM con cuentas de equipo. Se reutiliza
  // resolveStaffLogin() -- misma fuente de verdad que /api/account/access-check
  // -- en modo readOnly (nunca debe mutar employees.user_id desde aquí, ese
  // efecto secundario le pertenece únicamente a /api/staff/resolve-login).
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    // No hay forma de verificar si es staff. Este endpoint es puramente
    // aditivo/no-crítico (ver comentario de cabecera) -- ante la duda, se
    // prefiere NO crear la fila en `clients` (evita contaminar el CRM) en
    // vez de fallar cerrado con un error ruidoso que el caller ya ignora.
    console.error(
      "ensure-registered: SUPABASE_SERVICE_ROLE_KEY missing, skipping client-row creation to avoid mis-registering possible staff account"
    );
    return NextResponse.json({ clientId: null, created: false, skipped: "staff_check_unavailable" }, { status: 200 });
  }

  const staffResult = await resolveStaffLogin(serviceClient, user.id, user.email, { readOnly: true });
  if (staffResult.authorized) {
    return NextResponse.json({ clientId: null, created: false, skipped: "staff_account" }, { status: 200 });
  }

  try {
    const { clientId, created } = await ensureClientForAuthUser({
      authUserId: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
    });

    return NextResponse.json({ clientId, created }, { status: 200 });
  } catch (error) {
    // Nunca exponer el mensaje real al cliente -- mismo criterio que el
    // resto del repo (ver requireAdminRole / admin_action_logs en
    // src/lib/admin.ts).
    console.error("ensure-registered: failed to ensure client for auth user", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

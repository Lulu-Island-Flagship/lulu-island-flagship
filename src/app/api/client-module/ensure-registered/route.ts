import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ensureClientForAuthUser } from "@/lib/client-module/client-service";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

// Mismo patrón exacto que getSupabaseClient() en src/lib/admin.ts: cliente
// anon + cookies de la request vía @supabase/ssr, para leer la sesión ya
// establecida por el flujo de auth existente (AuthModal.tsx / auth/callback
// route.ts) SIN tocar ni reimplementar esa lógica -- este endpoint solo
// LEE el usuario ya autenticado, nunca inicia ni modifica sesión.
function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // No-op: mismo caso documentado en src/lib/admin.ts (llamado
          // desde un contexto donde escribir cookies no está permitido).
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // No-op, ver arriba.
        }
      },
    },
  });
}

// Endpoint puramente aditivo: vincula (o crea) la fila de `clients`
// correspondiente al usuario ya autenticado por el flujo existente. Nunca
// falla ruidosamente -- si no hay sesión, simplemente no hay nada que
// adjuntar (401 silencioso, no un error de servidor). Se llama desde
// EnsureClientRegistration.tsx tras SIGNED_IN, en segundo plano, sin
// impacto en el flujo de login/checkout ya en producción.
export async function POST() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
import { ensureClientForAuthUser } from "@/lib/client-module/client-service";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
    },
  });
}

/**
 * GET /api/client/payment-methods/[id]/token
 * Devuelve el provider_token (Stripe payment_method_id) para usar en el checkout.
 * Solo accesible para el dueño autenticado del método de pago.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

  const { clientId } = await ensureClientForAuthUser(
    { authUserId: user.id, email: user.email ?? null, phone: user.phone ?? null },
    supabase
  );

  const { data: method, error } = await supabase
    .from("client_payment_methods")
    .select("id, provider_token, last_four")
    .eq("id", id)
    .eq("client_id", clientId)
    .eq("status", "active")
    .single();

  if (error || !method) {
    return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: (method as { id: string }).id,
    providerToken: (method as { provider_token: string | null }).provider_token,
    lastFour: (method as { last_four: string | null }).last_four,
  });
}

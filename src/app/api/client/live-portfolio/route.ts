import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isWithdrawalWindowOpen } from "@/lib/live-portfolio";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * GET /api/client/live-portfolio — v8.3 E5.15: entradas del cliente
 * (cualquier estado) para que pueda ver si un servicio suyo fue
 * seleccionado/aprobado y ejercer su derecho de retiro (<24h) mientras
 * la ventana siga abierta.
 */
export async function GET(_request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("live_portfolio_candidates")
    .select("id, order_id, anonymous_label, status, approved_at, withdrawal_deadline, withdrawn_at, created_at")
    .eq("client_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

  const nowIso = new Date().toISOString();
  const entries = (data || []).map((entry) => ({
    ...entry,
    canWithdraw:
      entry.status === "approved" && !!entry.approved_at && isWithdrawalWindowOpen(entry.approved_at, nowIso),
  }));

  return NextResponse.json({ entries }, { status: 200 });
}

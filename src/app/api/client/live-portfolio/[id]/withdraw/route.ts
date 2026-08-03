import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isWithdrawalWindowOpen } from "@/lib/live-portfolio";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { isValidUuid } from "@/lib/validation";
import { requireClientCaller } from "@/lib/require-client-caller";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
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
 * POST /api/client/live-portfolio/[id]/withdraw — v8.3 E5.15
 *
 * "Derecho de retiro <24h": el cliente puede retirar su servicio del Live
 * Portfolio hasta 24h después de la aprobación admin. Después de la
 * ventana, la ruta rechaza -- el retiro tardío requeriría un proceso
 * administrativo distinto (no cubierto aquí), documentado como límite
 * explícito en vez de simularlo.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  // Fix (auditoría de integridad de datos 2026-08-01): params.id no se
  // validaba como UUID antes de usarse contra live_portfolio_candidates.
  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { data: entry, error: fetchError } = await supabase
    .from("live_portfolio_candidates")
    .select("id, client_user_id, status, approved_at")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchError) {
    console.error("fetchError:", fetchError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!entry || entry.client_user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (entry.status !== "approved") {
    return NextResponse.json(
      { error: `Cannot withdraw an entry with status '${entry.status}'` },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();
  if (!entry.approved_at || !isWithdrawalWindowOpen(entry.approved_at, nowIso)) {
    return NextResponse.json(
      { error: "The 24-hour withdrawal window has closed for this entry" },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("live_portfolio_candidates")
    .update({ status: "withdrawn", withdrawn_at: nowIso, updated_at: nowIso })
    .eq("id", params.id)
    .select()
    .single();

  if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

  return NextResponse.json({ entry: data }, { status: 200 });
}

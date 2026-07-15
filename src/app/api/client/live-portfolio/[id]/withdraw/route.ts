import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isWithdrawalWindowOpen } from "@/lib/live-portfolio";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
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

  const { data: entry, error: fetchError } = await supabase
    .from("live_portfolio_candidates")
    .select("id, client_user_id, status, approved_at")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entry: data }, { status: 200 });
}

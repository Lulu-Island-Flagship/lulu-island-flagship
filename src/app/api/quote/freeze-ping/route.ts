import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

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

const FREEZE_WINDOW_MS = 10 * 60 * 1000; // 10 min, igual que /api/quote y /api/quote/recalculate
// v8.3 fix (auditoría E1 2026-07-18): el spec pide "latencia de red, no
// cronómetro regresivo visible" -- el freeze original de 10 min era un timer
// fijo sin renovación: un cliente activo llenando datos de tarjeta / pasando
// por 3-D Secure podía perder su precio aunque siguiera trabajando. Este
// endpoint es el mecanismo de renovación: el frontend lo llama
// periódicamente (heartbeat) mientras el cliente está en la página de
// reserva, y cada llamada extiende price_frozen_until otros 10 min desde
// AHORA -- pero nunca más allá de un techo absoluto (MAX_FREEZE_MS) medido
// desde la aceptación original de la cotización, para que esto no se
// convierta en un hold de precio indefinido si alguien deja la pestaña
// abierta toda la noche.
const MAX_FREEZE_FROM_ACCEPT_MS = 60 * 60 * 1000; // techo absoluto: 60 min desde accepted_at

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { quoteId } = body;

    if (!quoteId) {
      return NextResponse.json({ error: "quoteId is required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, price_frozen_until, accepted_at, created_at")
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .single();

    if (quoteError || !quoteRow) {
      return NextResponse.json({ error: "Quote not found or unauthorized" }, { status: 404 });
    }

    if (quoteRow.status !== "pending") {
      return NextResponse.json(
        { error: `Quote is already ${quoteRow.status}; freeze ping does not apply.` },
        { status: 409 }
      );
    }

    const currentFreeze = new Date(quoteRow.price_frozen_until);
    if (currentFreeze < new Date()) {
      return NextResponse.json(
        { error: "Quote has already expired. Please generate a new quote.", code: "FREEZE_EXPIRED" },
        { status: 410 }
      );
    }

    // Techo absoluto: nunca extender más allá de accepted_at (o created_at
    // si accepted_at no existe) + MAX_FREEZE_FROM_ACCEPT_MS.
    const acceptedAt = new Date(quoteRow.accepted_at || quoteRow.created_at);
    const hardCap = new Date(acceptedAt.getTime() + MAX_FREEZE_FROM_ACCEPT_MS);
    const proposedFreeze = new Date(Date.now() + FREEZE_WINDOW_MS);
    const newFreeze = proposedFreeze < hardCap ? proposedFreeze : hardCap;

    if (newFreeze <= new Date()) {
      return NextResponse.json(
        {
          error: "Maximum price hold duration reached. Please generate a new quote.",
          code: "FREEZE_HARD_CAP_REACHED",
        },
        { status: 410 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("quotes")
      .update({ price_frozen_until: newFreeze.toISOString() })
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .select("id, price_frozen_until")
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ error: updateError?.message || "Failed to extend price hold" }, { status: 500 });
    }

    return NextResponse.json(
      { priceFrozenUntil: updated.price_frozen_until },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

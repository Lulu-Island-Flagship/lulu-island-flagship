import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";

/**
 * GET /api/communications/unsubscribe?token=... — unsubscribe de un toque,
 * SIN login (v8.3 E6.5, obligación CASL). El link va en cada email de
 * marketing (renderTemplate en send-communication.ts debe incluir
 * {unsubscribe_link} construido con buildUnsubscribeLink más abajo).
 *
 * Usa el cliente anon (no service role): la única operación posible es la
 * RPC unsubscribe_by_token, acotada por diseño a un solo UPDATE (ver
 * migración 154) -- no se amplía la superficie de escritura pública.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token es obligatorio" }, { status: 400 });
  }

  const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());
  const { data: found, error } = await supabase.rpc("unsubscribe_by_token", { p_token: token });

  if (error) {
    console.error("Supabase query error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!found) {
    return NextResponse.json({ error: "Token no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ unsubscribed: true }, { status: 200 });
}

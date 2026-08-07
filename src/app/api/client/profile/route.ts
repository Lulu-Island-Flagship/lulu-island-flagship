import { NextRequest, NextResponse } from "next/server";

import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";

// GET/POST /api/client/profile — nombre y foto de perfil del cliente
// autenticado (tabla `profiles`, no `client_profiles`).
//
// Contexto (2026-08-02): full_name/avatar_url existen en `profiles` desde la
// migración 001 pero nunca se leían/escribían desde ningún lado de la app.
// La migración 330 los prellena desde Google en el primer login (SOLO si
// están NULL, ver esa migración) -- esta ruta es donde el cliente puede ver
// y CORREGIR ese valor después, porque Google "no siempre está actualizado"
// (reporte del usuario). avatar_url se expone de solo lectura (viene de
// Google; no se ofrece subir/pegar una URL arbitraria de foto -- eso es una
// superficie distinta, subida de archivos, fuera de alcance de este cambio).
const MAX_NAME_LENGTH = 120;

export async function GET() {
  const supabase = createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("client/profile GET error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json(
    { fullName: data?.full_name ?? null, avatarUrl: data?.avatar_url ?? null },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const supabase = createRouteSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  let body: { fullName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (typeof body.fullName !== "string") {
    return NextResponse.json({ error: "fullName es obligatorio" }, { status: 400 });
  }
  const fullName = body.fullName.trim();
  if (fullName.length === 0) {
    return NextResponse.json({ error: "fullName no puede estar vacío" }, { status: 400 });
  }
  if (fullName.length > MAX_NAME_LENGTH) {
    return NextResponse.json({ error: `fullName no puede superar ${MAX_NAME_LENGTH} caracteres` }, { status: 400 });
  }

  // upsert (no update): un cliente que se registró por email/teléfono OTP
  // (sin login social) puede no tener fila en `profiles` todavía si nunca
  // disparó sync_profile_email() -- mismo motivo que communication-preferences/route.ts
  // usa upsert en vez de update para client_profiles.
  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, full_name: fullName }, { onConflict: "id" })
    .select("full_name, avatar_url")
    .single();

  if (error) {
    console.error("client/profile POST error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ fullName: data.full_name, avatarUrl: data.avatar_url }, { status: 200 });
}

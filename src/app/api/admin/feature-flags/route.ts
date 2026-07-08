import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * v8.3 E0-C4 — API del panel de feature flags (wireframe aprobado por el dueño).
 * GET:   lista de flags agrupables por módulo. Solo owner_admin.
 * PATCH: enciende/apaga un flag por nombre. Solo owner_admin.
 *        Queda en admin_action_logs vía requireAdminRole (método != GET).
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("feature_flags", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .select("nombre, activo, modulo, descripcion, es_critico, updated_at")
    .is("deleted_at", null)
    .order("modulo", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ flags: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("feature_flags", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { nombre?: string; activo?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.nombre || typeof body.activo !== "boolean") {
    return NextResponse.json(
      { error: "Se requiere { nombre: string, activo: boolean }" },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .update({ activo: body.activo, updated_by: auth.user.id })
    .eq("nombre", body.nombre)
    .is("deleted_at", null)
    .select("nombre, activo, modulo, es_critico, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ flag: data });
}

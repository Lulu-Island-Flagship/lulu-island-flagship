import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// v8.3 E8 FIX-6 — CRUD básico de equipos (teams, migración 099). La tabla
// ya existía (identidad mínima: nombre + avatar iniciales/color, sin fotos,
// para alimentar el ranking Top-3 semanal), pero no había ningún endpoint
// admin para crearlos o editarlos -- solo se podía insertar a mano en la
// base de datos. Sin UPDATE/DELETE reales: "active" se apaga con PATCH en
// vez de borrar (mismo patrón que el resto del sistema, prevent_hard_delete
// ya bloquea el DELETE físico a nivel de trigger).

// GET /api/admin/teams — lista de equipos
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("teams", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const includeInactive = searchParams.get("include_inactive") === "true";

  let query = auth.supabase
    .from("teams")
    .select("id, name, avatar_initials, avatar_color, active, created_at")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ teams: data || [] }, { status: 200 });
}

// POST /api/admin/teams — { name, avatarInitials?, avatarColor? }
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("teams", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("teams")
      .insert({
        name,
        avatar_initials: body.avatarInitials || name.slice(0, 2).toUpperCase(),
        avatar_color: body.avatarColor || null,
      })
      .select("id, name, avatar_initials, avatar_color, active, created_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ team: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/admin/teams — { id, name?, avatarInitials?, avatarColor?, active? }
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("teams", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    if (!body.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.avatarInitials === "string") updates.avatar_initials = body.avatarInitials;
    if (typeof body.avatarColor === "string") updates.avatar_color = body.avatarColor;
    if (typeof body.active === "boolean") updates.active = body.active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("teams")
      .update(updates)
      .eq("id", body.id)
      .is("deleted_at", null)
      .select("id, name, avatar_initials, avatar_color, active, created_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Team not found" }, { status: 404 });

    return NextResponse.json({ team: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

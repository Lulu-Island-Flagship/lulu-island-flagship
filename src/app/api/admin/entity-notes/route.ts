import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { suggestNotesForContext, type EntityNote, type EntityType } from "@/lib/entity-notes";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/entity-notes?entityType=employee&entityId=...&context=dispatch
//   context es opcional: si se envía, filtra por suggestNotesForContext();
//   si no, devuelve todas las notas de la entidad (vista completa).
// POST /api/admin/entity-notes — { entityType, entityId, note, suggestContext? }
// DELETE /api/admin/entity-notes?id=... — soft delete
//
// Resource "dispatch": las notas existen precisamente para decisiones de
// despacho/checkin/cotización — no encajan en "finance". dispatch ya
// incluye ops_coordinator, que es quien más las usa en campo.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entityType = request.nextUrl.searchParams.get("entityType") as EntityType | null;
  const entityId = request.nextUrl.searchParams.get("entityId");
  const context = request.nextUrl.searchParams.get("context");

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType y entityId son obligatorios" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("entity_notes")
    .select("id, entity_type, entity_id, note, suggest_context, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("admin/entity-notes error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const notes: EntityNote[] = (data || []).map((n) => ({
    id: n.id,
    entityType: n.entity_type,
    entityId: n.entity_id,
    note: n.note,
    suggestContext: n.suggest_context || [],
  }));

  const result = context ? suggestNotesForContext(notes, context) : notes;

  return NextResponse.json({ notes: result }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fix (revisión 2026-07-30, punto 11): request.json() sin try/catch --
  // un body no-JSON tronaba con una excepción no controlada (500 con fuga de
  // stack trace) en vez de un 400 controlado. Mismo patrón ya usado en
  // src/app/api/admin/marketing/route.ts.
  let body: { entityType?: string; entityId?: string; note?: string; suggestContext?: unknown };
  try {
    body = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 400, "JSON inválido");
  }
  if (!body.entityType || !body.entityId || !body.note?.trim()) {
    return NextResponse.json({ error: "entityType, entityId y note son obligatorios" }, { status: 400 });
  }

  // Fix (auditoría externa, hallazgo confirmado 2026-08-02): created_by
  // nunca se poblaba en el insert, aunque la columna existe desde la
  // migración 050 -- eso hacía imposible restringir el DELETE por autoría
  // (ver DELETE más abajo).
  const { data: actorEmployee } = await supabase
    .from("employees")
    .select("id")
    .eq("user_id", auth.user?.id ?? "")
    .maybeSingle();

  const { data, error } = await supabase
    .from("entity_notes")
    .insert({
      entity_type: body.entityType,
      entity_id: body.entityId,
      note: body.note.trim(),
      suggest_context: Array.isArray(body.suggestContext) ? body.suggestContext : [],
      created_by: actorEmployee?.id ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error("admin/entity-notes error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ note: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
  }

  // Fix (auditoría externa, hallazgo confirmado 2026-08-02): el recurso
  // "dispatch" incluye ops_coordinator, y este endpoint dejaba borrar
  // CUALQUIER nota de entidad (de cualquier autor, de cualquier entidad)
  // con solo ese rol -- sin verificar autoría. Ahora solo el empleado que
  // creó la nota (created_by) o un owner_admin puede borrarla.
  const isOwnerAdmin = auth.roles.includes("owner_admin");
  if (!isOwnerAdmin) {
    const { data: actorEmployee } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id ?? "")
      .maybeSingle();

    const { data: noteRow, error: noteError } = await supabase
      .from("entity_notes")
      .select("id, created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (noteError) {
      console.error("admin/entity-notes error:", noteError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!noteRow) {
      return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });
    }
    if (!actorEmployee || noteRow.created_by !== actorEmployee.id) {
      return NextResponse.json(
        { error: "Forbidden — solo el autor de la nota o un owner_admin puede borrarla" },
        { status: 403 }
      );
    }
  }

  const { error } = await supabase.from("entity_notes").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    console.error("admin/entity-notes error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

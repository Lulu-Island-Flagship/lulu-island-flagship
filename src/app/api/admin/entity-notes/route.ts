import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { suggestNotesForContext, type EntityNote, type EntityType } from "@/lib/entity-notes";

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const body = await request.json();
  if (!body.entityType || !body.entityId || !body.note?.trim()) {
    return NextResponse.json({ error: "entityType, entityId y note son obligatorios" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("entity_notes")
    .insert({
      entity_type: body.entityType,
      entity_id: body.entityId,
      note: body.note.trim(),
      suggest_context: Array.isArray(body.suggestContext) ? body.suggestContext : [],
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
  const { error } = await supabase.from("entity_notes").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

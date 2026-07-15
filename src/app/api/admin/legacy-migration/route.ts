import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/legacy-migration — checklist con estado.
// POST /api/admin/legacy-migration — { itemKey } marca completado ahora.
//
// Resource "finance": mismo bucket que seo-local/stress-scenario — decisión
// administrativa única, no encaja en dispatch/services.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("legacy_migration_checklist_items")
    .select("item_key, label, completed_at, notes")
    .is("deleted_at", null)
    .order("item_key");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  if (!body.itemKey) {
    return NextResponse.json({ error: "itemKey requerido" }, { status: 400 });
  }

  const { error } = await supabase
    .from("legacy_migration_checklist_items")
    .update({ completed_at: new Date().toISOString(), completed_by: user?.id ?? null, updated_at: new Date().toISOString() })
    .eq("item_key", body.itemKey)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}

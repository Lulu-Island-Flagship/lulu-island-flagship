import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient, logAdminAction } from "@/lib/admin";

// GET /api/admin/legacy-migration — checklist con estado.
// POST /api/admin/legacy-migration — { itemKey } marca completado ahora.
//
// Resource "finance": mismo bucket que seo-local/stress-scenario — decisión
// administrativa única, no encaja en dispatch/services.
//
// v8.3 E11 (auditoría 2026-07-18): legacy_migration_checklist_items tiene
// RLS `USING (false)` (migración 164) -- solo accesible vía service role.
// requireAdminRole() sigue autorizando (rol + audit log), pero las
// operaciones de datos usan el cliente service role.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (service role)" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("legacy_migration_checklist_items")
    .select("item_key, label, completed_at, notes")
    .is("deleted_at", null)
    .order("item_key");
  if (error) {
    console.error("admin/legacy-migration error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { user } = auth;
  if (!auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const supabase = getServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (service role)" }, { status: 500 });
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
  if (error) {
    console.error("admin/legacy-migration error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

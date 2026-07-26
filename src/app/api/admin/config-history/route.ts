import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * v8.3 E0-C6 — Historial de cambios de configuración + Deshacer.
 * GET:  lista de snapshots (filtro opcional ?table=). Solo owner_admin.
 * POST: { snapshot_id } => deshace ese cambio vía RPC auditado.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const table = request.nextUrl.searchParams.get("table");
  let query = auth.supabase
    .from("config_snapshots")
    .select("id, table_name, row_id, values_before, values_after, reason, changed_by, created_at, undone_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (table) query = query.eq("table_name", table);

  const { data, error } = await query;
  if (error) {
    console.error("admin/config-history error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ snapshots: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { snapshot_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.snapshot_id) {
    return NextResponse.json({ error: "Se requiere snapshot_id" }, { status: 400 });
  }

  const { data, error } = await auth.supabase.rpc("admin_undo_config_snapshot", {
    p_snapshot_id: body.snapshot_id,
  });
  if (error) {
    console.error("admin/config-history error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ restored: data });
}

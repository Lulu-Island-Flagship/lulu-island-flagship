import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/content — list all site_content keys (admin panel)
 * PUT /api/admin/content — update one key: { key, value }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("site_content", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("site_content")
    .select("key, value, updated_at")
    .order("key");

  if (error) {
    return NextResponse.json({ error: "Failed to load content" }, { status: 500 });
  }

  return NextResponse.json({ content: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminRole("site_content", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await request.json();
  const { key, value } = body;

  if (!key || value === undefined) {
    return NextResponse.json({ error: "Missing key or value" }, { status: 400 });
  }

  const { error } = await auth.supabase
    .from("site_content")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: "Failed to save content" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, key });
}

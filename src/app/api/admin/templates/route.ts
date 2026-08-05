import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/templates — List all templates
// POST /api/admin/templates — Create or update a template (upsert by template_id)

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("services", request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const channel = new URL(request.url).searchParams.get("channel");

  let query = auth.supabase
    .from("communication_templates")
    .select("*")
    .order("template_id", { ascending: true });

  if (channel) query = query.eq("channel", channel);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }

  return NextResponse.json({ templates: data || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("services", request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const body = await request.json();
  const { template_id, channel, subject, body: templateBody, variables } = body;

  if (!template_id || !channel || !templateBody) {
    return NextResponse.json({ error: "template_id, channel, and body are required" }, { status: 400 });
  }

  // Get current version to increment
  const { data: existing } = await auth.supabase
    .from("communication_templates")
    .select("version")
    .eq("template_id", template_id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const newVersion = (existing?.version || 0) + 1;

  const { data, error } = await auth.supabase
    .from("communication_templates")
    .upsert({
      template_id,
      channel,
      subject: subject || null,
      body: templateBody,
      variables: variables || [],
      version: newVersion,
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "template_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save template" }, { status: 500 });
  }

  return NextResponse.json({ template: data }, { status: 200 });
}

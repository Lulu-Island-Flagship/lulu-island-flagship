import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * PATCH /api/admin/retention-gifts/[id] — { action: 'approve'|'deliver' }
 *
 * v8.3 E9.11: cierra el gap de que retention_gifts.approved_at/approved_by/
 * delivered_at existían en el esquema (migración 051) pero ninguna ruta los
 * podía escribir -- todo regalo con requires_manual_approval=true se
 * quedaba sin forma de aprobarse.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase, user } = auth;

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { data: gift, error: fetchError } = await supabase
    .from("retention_gifts")
    .select("id, requires_manual_approval, approved_at, delivered_at")
    .eq("id", params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!gift) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nowIso = new Date().toISOString();

  if (body.action === "approve") {
    if (!gift.requires_manual_approval) {
      return NextResponse.json({ error: "This gift does not require manual approval" }, { status: 400 });
    }
    if (gift.approved_at) {
      return NextResponse.json({ error: "Already approved" }, { status: 409 });
    }
    const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).maybeSingle();
    const { data, error } = await supabase
      .from("retention_gifts")
      .update({ approved_at: nowIso, approved_by: employee?.id ?? null })
      .eq("id", params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ gift: data }, { status: 200 });
  }

  if (body.action === "deliver") {
    if (gift.requires_manual_approval && !gift.approved_at) {
      return NextResponse.json({ error: "Cannot mark delivered before manual approval" }, { status: 409 });
    }
    const { data, error } = await supabase
      .from("retention_gifts")
      .update({ delivered_at: nowIso })
      .eq("id", params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ gift: data }, { status: 200 });
  }

  return NextResponse.json({ error: "action must be 'approve' or 'deliver'" }, { status: 400 });
}

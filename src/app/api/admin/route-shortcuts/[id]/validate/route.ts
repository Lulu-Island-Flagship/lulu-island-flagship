import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { SHORTCUT_VALIDATED_BONUS_CENTS } from "@/lib/wellbeing-bonus";

// PATCH /api/admin/route-shortcuts/[id]/validate — un supervisor valida un
// atajo reportado. Paga el bono de +$10 UNA sola vez (validated_at es el
// guardia: si ya tiene fecha, no se vuelve a pagar).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("wellbeing", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase, user } = auth;

  const { data: existing, error: fetchError } = await supabase
    .from("route_shortcuts")
    .select("id, employee_id, validated_at")
    .eq("id", params.id)
    .is("deleted_at", null)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json({ error: "Route shortcut not found" }, { status: 404 });
  }

  if (existing.validated_at) {
    return NextResponse.json({ error: "Already validated" }, { status: 409 });
  }

  const nowISO = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("route_shortcuts")
    .update({ validated_at: nowISO, validated_by: user.id })
    .eq("id", params.id)
    .select("id, description, uses_count, reported_at, validated_at")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: bonusError } = await supabase.from("employee_wellbeing_bonuses").insert({
    employee_id: existing.employee_id,
    source: "shortcut_validated",
    bonus_cents: SHORTCUT_VALIDATED_BONUS_CENTS,
    credit_date: nowISO.split("T")[0],
    notes: `Atajo de ruta validado: route_shortcuts ${existing.id}`,
  });

  if (bonusError) {
    console.error("Failed to credit shortcut bonus (shortcut already validated):", bonusError);
  }

  return NextResponse.json({ shortcut: updated, bonusAwarded: !bonusError }, { status: 200 });
}

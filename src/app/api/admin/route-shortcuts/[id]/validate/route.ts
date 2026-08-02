import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { SHORTCUT_VALIDATED_BONUS_CENTS } from "@/lib/wellbeing-bonus";
import { isValidUuid } from "@/lib/validation";

// PATCH /api/admin/route-shortcuts/[id]/validate — un supervisor valida un
// atajo reportado. Paga el bono de +$10 UNA sola vez.
//
// Migración 320: el UPDATE (marcar validado) y el INSERT (pagar el bono)
// ocurren atómicamente dentro de validate_route_shortcut_atomic (CAS sobre
// validated_at IS NULL), en vez de leer/chequear/actualizar/insertar en
// llamadas HTTP separadas -- eso permitía que dos PATCH concurrentes pagaran
// el bono dos veces por el mismo atajo.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("wellbeing", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase, user } = auth;

  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("validate_route_shortcut_atomic", {
      p_shortcut_id: params.id,
      p_validator_user_id: user.id,
      p_bonus_cents: SHORTCUT_VALIDATED_BONUS_CENTS,
    })
    .single();

  if (error) {
    if (error.message?.includes("SHORTCUT_NOT_FOUND")) {
      return NextResponse.json({ error: "Route shortcut not found" }, { status: 404 });
    }
    if (error.message?.includes("SHORTCUT_ALREADY_VALIDATED")) {
      return NextResponse.json({ error: "Already validated" }, { status: 409 });
    }
    console.error("admin/route-shortcuts/[id]/validate error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const row = data as {
    id: string;
    description: string;
    uses_count: number;
    reported_at: string;
    validated_at: string;
    bonus_awarded: boolean;
  };

  return NextResponse.json(
    {
      shortcut: {
        id: row.id,
        description: row.description,
        uses_count: row.uses_count,
        reported_at: row.reported_at,
        validated_at: row.validated_at,
      },
      bonusAwarded: row.bonus_awarded,
    },
    { status: 200 }
  );
}

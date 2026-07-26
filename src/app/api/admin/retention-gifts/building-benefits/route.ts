import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { createPropertyManagerBenefit } from "@/lib/gift-program";

/**
 * GET/POST /api/admin/retention-gifts/building-benefits — v8.3 E9.11
 *
 * Vía (a) del beneficio a property managers: "beneficio transparente al
 * edificio". Nunca acepta un regalo personal oculto -- createPropertyManagerBenefit
 * (src/lib/gift-program.ts) solo construye este tipo o lanza si se intenta
 * otro. La vía (b) (comisión declarada) usa el sistema de partners/
 * partner_commissions ya existente (migración 147) -- no se duplica aquí.
 */
export async function GET() {
  const auth = await requireAdminRole("finance");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data, error } = await auth.supabase
    .from("property_manager_building_benefits")
    .select("id, partner_id, description, delivered_at, created_at, partners(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin/retention-gifts/building-benefits error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ benefits: data || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase, user } = auth;

  try {
    const body = await request.json();
    const { partnerId, description } = body as { partnerId?: string; description?: string };

    if (!partnerId || !description || description.trim().length === 0) {
      return NextResponse.json({ error: "partnerId and description are required" }, { status: 400 });
    }

    // Valida por runtime que solo exista la vía transparente -- si algún día
    // se agrega un segundo "tipo" aquí por error, esto lo bloquea.
    const benefit = createPropertyManagerBenefit("transparent_building_benefit", description.trim());

    const { data, error } = await supabase
      .from("property_manager_building_benefits")
      .insert({
        partner_id: partnerId,
        description: benefit.description,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/retention-gifts/building-benefits error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ benefit: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

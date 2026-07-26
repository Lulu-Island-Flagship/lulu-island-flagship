import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/warranty-claims — cola de reclamos de garantía (v8.3 E5,
// Sesión Q). Reutiliza el recurso RBAC "tickets" (mismo dominio operativo
// que tickets_disputas; no se toca admin-rbac.ts para esto).
//
// IMPORTANTE (privacidad, client-visible-columns.ts): esta ruta es
// admin-only y nunca es llamada desde páginas de cliente, pero de todos
// modos no selecciona ninguna columna de score/N/HHE — warranty_claims no
// las tiene, así que no hay nada que filtrar aquí.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "open";

    const { data, error } = await auth.supabase
      .from("warranty_claims")
      .select(`
        id,
        order_id,
        reason,
        description,
        claim_zone,
        status,
        severity,
        decision_outcome,
        requires_human_review,
        final_action,
        opened_at,
        resolved_at,
        resolution_notes,
        auto_resolved,
        orders:order_id (service_date, service_time),
        warranty_photo_evidence (id, photo_url, photo_type, zone, item_label)
      `)
      .eq("status", status)
      .order("severity", { ascending: false }) // critical primero
      .order("opened_at", { ascending: true });

    if (error) {
      console.error("admin/warranty-claims error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ claims: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

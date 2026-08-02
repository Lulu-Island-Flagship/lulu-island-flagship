import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/quotes
 *
 * Lista cotizaciones que requieren revisión administrativa
 * (admin_review_required = true) o todas si se pasa ?status=pending.
 *
 * v8.3 Sesión P — antes usaba un guard ad-hoc (service-role key + is_supervisor
 * RPC, sin pasar por la matriz RBAC ni dejar log de auditoría). Ahora usa el
 * guard estándar requireAdminRole con el recurso "quotes_review" (ya existente
 * en admin-rbac.ts: owner_admin + ops_coordinator), igual que cualquier otra
 * ruta admin.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("quotes_review", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const supabase = auth.supabase;
    const { searchParams } = new URL(request.url);
    const onlyReview = searchParams.get("review") !== "false";

    let query = supabase
      .from("quotes")
      .select(
        "id, user_id, service_category, service_subtype, service_type, bedrooms, bathrooms, square_feet, address, zone, subtotal, total, hold_amount, estimated_margin_contribution, admin_review_required, admin_review_reason, client_score, created_at"
      )
      .order("created_at", { ascending: false });

    if (onlyReview) {
      query = query.eq("admin_review_required", true);
    }

    const { data: quotes, error } = await query;

    if (error) {
      console.error("Admin quotes fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ quotes: quotes || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

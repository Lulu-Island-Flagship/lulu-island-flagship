import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/admin/quotes
 *
 * Lista cotizaciones que requieren revisión administrativa
 * (admin_review_required = true) o todas si se pasa ?status=pending.
 *
 * Seguridad: solo supervisores.
 */

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: "Supabase service credentials not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = request.headers.get("authorization");
    let userId: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const { data } = await supabase.auth.getUser(token);
      userId = data.user?.id ?? null;
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: isSupervisor } = await supabase.rpc("is_supervisor", {
      user_uuid: userId,
    });
    if (!isSupervisor) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quotes: quotes || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin quotes error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

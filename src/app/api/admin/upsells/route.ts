import { NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/upsells — upsells pendientes de revisión (reviewed_by_admin = false)
export async function GET() {
  const auth = await requireAdminRole("upsells_review");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    // Fetch upsells with orders (separate from quotes to avoid nested join issues)
    const { data: upsells, error } = await auth.supabase
      .from("service_upsells")
      .select(`
        id,
        order_id,
        employee_id,
        upsell_type,
        upsell_label,
        amount,
        client_approved,
        notes,
        reviewed_by_admin,
        approval_status,
        created_at,
        orders:order_id (
          service_date,
          service_time,
          quote_id
        ),
        employees:employee_id (name, email)
      `)
      .eq("reviewed_by_admin", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Upsells fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Fetch quote addresses separately
    // Supabase returns orders as an array (even for single relation), so we access [0]
    const quoteIds = (upsells || [])
      .map((u: { orders?: { quote_id?: string }[] | null }) => u.orders?.[0]?.quote_id)
      .filter(Boolean);

    const quoteMap = new Map<string, { address: string }>();
    if (quoteIds.length > 0) {
      const { data: quotes } = await auth.supabase
        .from("quotes")
        .select("id, address")
        .in("id", quoteIds);

      for (const q of quotes || []) {
        quoteMap.set(q.id, q);
      }
    }

    // Enrich upsells with quote address
    const enriched = (upsells || []).map((u: { orders?: { quote_id?: string }[] | null }) => ({
      ...u,
      orders: u.orders?.[0] ? {
        ...u.orders[0],
        quotes: u.orders[0].quote_id ? { address: quoteMap.get(u.orders[0].quote_id)?.address || "" } : null,
      } : null,
    }));

    return NextResponse.json({ upsells: enriched }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

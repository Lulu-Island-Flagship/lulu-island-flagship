import { NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/upsells — upsells pendientes de revisión (reviewed_by_admin = false)
export async function GET() {
  const auth = await requireSupervisor();
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
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
        created_at,
        orders:order_id (
          service_date,
          service_time,
          quotes:quote_id (address)
        ),
        employees:employee_id (name, email)
      `)
      .eq("reviewed_by_admin", false)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Upsells fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ upsells: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin upsells error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

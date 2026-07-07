import { NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/empleados — lista de todos los empleados
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
      .from("employees")
      .select("id, name, email, role, phone, is_active, day_rate, languages, created_at")
      .order("name", { ascending: true });

    if (error) {
      console.error("Employees fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ employees: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Admin employees error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

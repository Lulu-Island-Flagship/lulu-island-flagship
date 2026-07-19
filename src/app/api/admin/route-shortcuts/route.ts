import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/route-shortcuts?pending=true — lista de atajos reportados
// por empleados, para que un supervisor los revise y valide.
// Resource "wellbeing": mismo bucket RBAC que el resto de E8 (owner_admin +
// ops_coordinator); no existe un recurso dedicado "route_shortcuts" y
// admin-rbac.ts está fuera de alcance salvo por el recurso "teams" (FIX-6).
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("wellbeing", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const pendingOnly = searchParams.get("pending") === "true";

  let query = auth.supabase
    .from("route_shortcuts")
    .select("id, employee_id, description, uses_count, reported_at, validated_at, employees(name)")
    .is("deleted_at", null)
    .order("reported_at", { ascending: false });

  if (pendingOnly) {
    query = query.is("validated_at", null);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ shortcuts: data || [] }, { status: 200 });
}


import { NextRequest, NextResponse } from "next/server";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
/**
 * GET /api/client/referral/leaders — lista mínima (id + nombre) de
 * empleados activos, para que el cliente referido pueda "mencionar" a quien
 * lo recomendó al canjear un código (+$5 de bono, v8.3 E5.13). Solo
 * id/name -- nunca datos sensibles de nómina/score del empleado.
 */
export async function GET(_request: NextRequest) {
  const supabase = await createRouteSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { data, error } = await supabase
    .from("employees")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

  return NextResponse.json({ leaders: data || [] }, { status: 200 });
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

const ALLOWED_TABLES = new Set(["employees", "client_properties", "vehicles", "client_profiles"]);

// GET /api/admin/entity-options?table=employees|client_properties|vehicles|client_profiles
// Lista mínima {id, label} para poblar selectores — usado por la página de
// notas operativas (E11.2) para elegir a qué entidad ligar una nota, sin
// duplicar los pickers ya existentes en dispatch/empleados/clientes (que
// están dentro de páginas densas que este cambio evita tocar).
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("dispatch", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const table = request.nextUrl.searchParams.get("table");
  if (!table || !ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: "table inválida" }, { status: 400 });
  }

  if (table === "employees") {
    const { data, error } = await supabase.from("employees").select("id, name").is("deleted_at", null).order("name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ options: (data || []).map((e: { id: string; name: string }) => ({ id: e.id, label: e.name })) });
  }

  if (table === "vehicles") {
    const { data, error } = await supabase.from("vehicles").select("id, name, plate").order("name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      options: (data || []).map((v: { id: string; name: string; plate: string | null }) => ({ id: v.id, label: v.plate ? `${v.name} (${v.plate})` : v.name })),
    });
  }

  if (table === "client_properties") {
    const { data, error } = await supabase.from("client_properties").select("id, nickname, address").eq("is_active", true).order("address");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      options: (data || []).map((p: { id: string; nickname: string | null; address: string }) => ({ id: p.id, label: p.nickname ? `${p.nickname} — ${p.address}` : p.address })),
    });
  }

  // client_profiles: usa profiles.full_name vía join manual (no hay FK directa consultable por PostgREST embed confiable aquí)
  const { data: profiles, error: profilesError } = await supabase.from("client_profiles").select("id, user_id").order("created_at", { ascending: false }).limit(200);
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });
  const userIds = (profiles || []).map((p: { user_id: string }) => p.user_id);
  const { data: names } = await supabase.from("profiles").select("id, full_name").in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  const nameById = new Map((names || []).map((n: { id: string; full_name: string | null }) => [n.id, n.full_name]));
  return NextResponse.json({
    options: (profiles || []).map((p: { id: string; user_id: string }) => ({ id: p.id, label: nameById.get(p.user_id) || p.user_id.slice(0, 8) })),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/checklists/history?type=zone&checklistId=...
// GET /api/admin/checklists/history?type=item&checklistId=...&itemId=...
//
// Fix (auditoría externa 2026-07-30, hallazgo confirmado): AdminChecklistsClient.tsx
// llamaba check_item_history/check_zone_history directo desde el navegador
// con el cliente Supabase anon (import { supabase } from "@/lib/supabase").
// Eso exponía el nombre/existencia de esas funciones RPC al cliente y, si
// la política RLS/permiso de la función no lo permitía, fallaba en
// silencio (sin pasar por requireAdminRole ni quedar auditado). Se mueve la
// lógica aquí -- mismo patrón que ya usa DELETE en
// src/app/api/admin/checklists/[id]/route.ts (check_zone_history vía el
// cliente autorizado por requireAdminRole).
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("checklists_sop", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const checklistId = searchParams.get("checklistId");
  const itemId = searchParams.get("itemId");

  if (type === "zone") {
    if (!checklistId) {
      return NextResponse.json({ error: "checklistId es requerido" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("check_zone_history", {
      p_checklist_id: checklistId,
    });
    if (error) {
      console.error("admin/checklists/history (zone) error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ hasHistory: !!data }, { status: 200 });
  }

  if (type === "item") {
    if (!checklistId || !itemId) {
      return NextResponse.json({ error: "checklistId e itemId son requeridos" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("check_item_history", {
      p_item_id: itemId,
      p_checklist_id: checklistId,
    });
    if (error) {
      console.error("admin/checklists/history (item) error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ hasHistory: !!data }, { status: 200 });
  }

  return NextResponse.json({ error: "type debe ser 'zone' o 'item'" }, { status: 400 });
}

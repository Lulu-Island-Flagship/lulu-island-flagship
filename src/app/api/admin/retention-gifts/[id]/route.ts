import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { isValidUuid } from "@/lib/validation";

/**
 * PATCH /api/admin/retention-gifts/[id] — { action: 'approve'|'deliver' }
 *
 * v8.3 E9.11: cierra el gap de que retention_gifts.approved_at/approved_by/
 * delivered_at existían en el esquema (migración 051) pero ninguna ruta los
 * podía escribir -- todo regalo con requires_manual_approval=true se
 * quedaba sin forma de aprobarse.
 */
export async function PATCH(request: NextRequest, { params: paramsPromise }: { params: Promise<{ id: string }> })
{
  const params = await paramsPromise;
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
  const { supabase, user } = auth;

  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { data: gift, error: fetchError } = await supabase
    .from("retention_gifts")
    .select("id, requires_manual_approval, approved_at, delivered_at")
    .eq("id", params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError) {
    console.error("admin/retention-gifts/[id] error:", fetchError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!gift) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nowIso = new Date().toISOString();

  if (body.action === "approve") {
    if (!gift.requires_manual_approval) {
      return NextResponse.json({ error: "This gift does not require manual approval" }, { status: 400 });
    }
    if (gift.approved_at) {
      return NextResponse.json({ error: "Already approved" }, { status: 409 });
    }
    const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).maybeSingle();
    // Fix (pentest Kimi, race condition operativa #3): el chequeo
    // `gift.approved_at` de arriba viene de un SELECT hecho ANTES de este
    // UPDATE -- dos PATCH concurrentes de acción 'approve' sobre el mismo
    // regalo ambos leían approved_at=null y ambos pasaban el chequeo, y
    // ambos ejecutaban este UPDATE (el segundo pisando approved_by del
    // primero, y potencialmente duplicando el efecto de "regalo aprobado"
    // río abajo). Se agrega `.is("approved_at", null)` como
    // compare-and-swap: solo el primer UPDATE concurrente afecta una fila;
    // el segundo no encuentra ninguna fila que matchee (approved_at ya no es
    // null) y `data` vuelve null -> se responde 409 en vez de pisar la
    // aprobación ya hecha.
    const { data, error } = await supabase
      .from("retention_gifts")
      .update({ approved_at: nowIso, approved_by: employee?.id ?? null })
      .eq("id", params.id)
      .is("approved_at", null)
      .select()
      .maybeSingle();
    if (error) {
      console.error("admin/retention-gifts/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Already approved" }, { status: 409 });
    }
    return NextResponse.json({ gift: data }, { status: 200 });
  }

  if (body.action === "deliver") {
    if (gift.requires_manual_approval && !gift.approved_at) {
      return NextResponse.json({ error: "Cannot mark delivered before manual approval" }, { status: 409 });
    }
    if (gift.delivered_at) {
      return NextResponse.json({ error: "Already delivered" }, { status: 409 });
    }
    // Fix (pentest Kimi, race condition operativa #3): mismo patrón que
    // 'approve' arriba -- dos PATCH concurrentes de 'deliver' podían ambos
    // pasar el chequeo previo (leído antes de escribir) y ambos ejecutar
    // este UPDATE. `.is("delivered_at", null)` hace que solo el primero
    // afecte una fila; el segundo recibe 409 en vez de re-marcar como
    // entregado un regalo que ya lo estaba (ej. doble descuento de
    // inventario si algún día se conecta a inventario real).
    const { data, error } = await supabase
      .from("retention_gifts")
      .update({ delivered_at: nowIso })
      .eq("id", params.id)
      .is("delivered_at", null)
      .select()
      .maybeSingle();
    if (error) {
      console.error("admin/retention-gifts/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Already delivered" }, { status: 409 });
    }
    return NextResponse.json({ gift: data }, { status: 200 });
  }

  return NextResponse.json({ error: "action must be 'approve' or 'deliver'" }, { status: 400 });
}

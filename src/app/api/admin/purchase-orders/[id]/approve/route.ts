import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * POST /api/admin/purchase-orders/[id]/approve — máquina de estados de la PO.
 *
 * v8.3 auditoría 2026-07-21 (E-A1, E-A2, A-3): la máquina de estados de
 * purchase_orders terminaba en 'approved' -- 'ordered', 'received' y
 * 'cancelled' existen en el CHECK de la tabla pero ningún código los
 * escribía, y `inventory_items.current_stock` nunca se reponía al recibir
 * mercancía (todo el motor de reposición corría sobre un número
 * congelado). Además la aprobación no tenía compare-and-swap: leía el
 * estado en un SELECT separado del UPDATE, dejando una ventana de
 * condición de carrera para doble aprobación concurrente.
 *
 * Body: { action?: "approve" | "mark_ordered" | "receive" }
 *   - Sin body / sin action: comportamiento legado, equivalente a "approve".
 *   - approve:      pending_approval -> approved
 *   - mark_ordered: approved         -> ordered
 *   - receive:      ordered          -> received; incrementa
 *                    inventory_items.current_stock por cada línea de la PO.
 *
 * Patrón de compare-and-swap copiado de
 * admin/warranty-claims/[id]/resolve:116 (el único CAS correcto del repo
 * antes de este cambio): el filtro de estado esperado va DIRECTO en el
 * UPDATE (.eq("status", expected)), no en un SELECT previo separado. Si
 * la fila ya cambió de estado entre el SELECT informativo y el UPDATE,
 * la actualización afecta 0 filas y se responde 409.
 *
 * C-H6 (auditoría 2026-07-21): segregación de funciones. POST
 * /admin/purchase-orders (crear) y esta ruta (aprobar/marcar
 * ordenada/recibir) usaban el mismo recurso RBAC "inventory", y
 * purchase_orders no tenía columna created_by -- nada impedía que la misma
 * persona creara y aprobara su propia orden de compra, ni había forma de
 * auditarlo después. Fix: purchase_orders.created_by (migración 232) +
 * bloqueo de autoaprobación abajo, solo en la acción "approve" (mark_ordered
 * y receive no tienen el mismo riesgo: ya requieren que la PO exista y esté
 * aprobada por alguien). Se decidió bloquear la autoaprobación SIEMPRE, sin
 * excepción para owner_admin -- determinar de forma segura si "no hay otro
 * admin disponible" requeriría consultar en vivo cuántos admins con acceso
 * a "inventory" existen y no están inactivos, lo cual introduce su propia
 * superficie de error; se prefiere el control simple y siempre activo.
 */

type Action = "approve" | "mark_ordered" | "receive";

const TRANSITIONS: Record<Action, { from: string; to: string }> = {
  approve: { from: "pending_approval", to: "approved" },
  mark_ordered: { from: "approved", to: "ordered" },
  receive: { from: "ordered", to: "received" },
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    let action: Action = "approve";
    try {
      const body = await request.json();
      if (body?.action) {
        if (!["approve", "mark_ordered", "receive"].includes(body.action)) {
          return NextResponse.json(
            { error: "action must be one of: approve, mark_ordered, receive" },
            { status: 400 }
          );
        }
        action = body.action;
      }
    } catch {
      // sin body: comportamiento legado (approve)
    }

    const transition = TRANSITIONS[action];

    // SELECT solo informativo (para dar un mensaje de error legible);
    // .is("deleted_at", null) evita aprobar/avanzar una PO borrada
    // lógicamente, algo que antes no se filtraba en absoluto.
    const { data: po, error: fetchError } = await supabase
      .from("purchase_orders")
      .select("id, status, created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }
    if (!po) {
      return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 });
    }
    if (po.status !== transition.from) {
      return NextResponse.json(
        {
          error: `No se puede aplicar '${action}': estado actual es '${po.status}', se requiere '${transition.from}'.`,
        },
        { status: 400 }
      );
    }

    // C-H6: segregación de funciones -- quien crea la PO no puede aprobarla.
    // Solo aplica a "approve" (el paso donde se compromete el gasto); no a
    // mark_ordered/receive.
    if (action === "approve" && po.created_by && po.created_by === auth.user?.id) {
      return NextResponse.json(
        {
          error:
            "No puedes aprobar una orden de compra que tú mismo creaste — requiere un segundo aprobador.",
        },
        { status: 409 }
      );
    }

    const { data: approver } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    const updatePayload: Record<string, unknown> = { status: transition.to };
    if (action === "approve") {
      updatePayload.approved_by = approver?.id || null;
      updatePayload.approved_at = new Date().toISOString();
    } else if (action === "mark_ordered") {
      updatePayload.ordered_at = new Date().toISOString();
    } else if (action === "receive") {
      updatePayload.received_at = new Date().toISOString();
    }

    // Compare-and-swap real: el filtro de estado esperado va en el propio
    // UPDATE. Si otra request ya movió la PO, esto actualiza 0 filas.
    const { data: updated, error: updateError } = await supabase
      .from("purchase_orders")
      .update(updatePayload)
      .eq("id", id)
      .eq("status", transition.from)
      .is("deleted_at", null)
      .select()
      .single();

    if (updateError) {
      // PGRST116: 0 filas afectadas por el .single() -- alguien ganó la carrera.
      if (updateError.code === "PGRST116") {
        return NextResponse.json(
          { error: "La orden de compra ya cambió de estado (condición de carrera). Recarga e intenta de nuevo." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // E-A2: al recibir mercancía, reponer el stock real. Antes
    // inventory_items.current_stock nunca se movía en ningún endpoint --
    // todo el motor de reposición (computeReorderSuggestions,
    // computeConsumptionProjections) corría sobre un número congelado.
    let stockUpdateErrors: string[] = [];
    if (action === "receive") {
      const { data: lines, error: linesError } = await supabase
        .from("purchase_order_lines")
        .select("inventory_item_id, quantity")
        .eq("purchase_order_id", id);

      if (linesError) {
        stockUpdateErrors.push(linesError.message);
      } else {
        for (const line of lines || []) {
          if (!line.inventory_item_id || !line.quantity) continue;
          const { data: item, error: itemError } = await supabase
            .from("inventory_items")
            .select("current_stock")
            .eq("id", line.inventory_item_id)
            .maybeSingle();

          if (itemError || !item) {
            stockUpdateErrors.push(
              `No se pudo leer inventory_items ${line.inventory_item_id}: ${itemError?.message || "no encontrado"}`
            );
            continue;
          }

          const newStock = Number(item.current_stock) + Number(line.quantity);
          const { error: stockError } = await supabase
            .from("inventory_items")
            .update({ current_stock: newStock })
            .eq("id", line.inventory_item_id);

          if (stockError) {
            stockUpdateErrors.push(`No se pudo actualizar stock de ${line.inventory_item_id}: ${stockError.message}`);
          }
        }
      }
    }

    return NextResponse.json(
      {
        purchaseOrder: updated,
        action,
        stockUpdateErrors: stockUpdateErrors.length > 0 ? stockUpdateErrors : undefined,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

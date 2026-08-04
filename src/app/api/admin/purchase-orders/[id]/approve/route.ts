import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
// Fix M13: Use centralized isValidUuid from @/lib/validation
import { isValidUuid } from "@/lib/validation";
import { safeErrorResponse } from "@/lib/api-errors";

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
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

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
      console.error("admin/purchase-orders/[id]/approve error:", fetchError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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

    // Auditoría 2026-07-30 (Bug #2): "receive" ya NO usa el update genérico
    // de abajo. Repone stock con read-modify-write en JS (propenso a lost
    // update) y no era atómico con el cambio de estado -- si fallaba la
    // reposición de alguna línea, la PO igual quedaba "received" y el
    // endpoint devolvía 200 con `stockUpdateErrors`. Ahora todo el cambio
    // de estado + reposición de stock ocurre dentro de una sola función
    // Postgres (receive_purchase_order, migración 247): todo o nada.
    if (action === "receive") {
      const { data: rpcResult, error: rpcError } = await supabase
        .rpc("receive_purchase_order", { p_po_id: id })
        .maybeSingle();

      if (rpcError) {
        if (rpcError.code === "P0002") {
          return NextResponse.json({ error: "Orden de compra no encontrada" }, { status: 404 });
        }
        if (rpcError.code === "P0001") {
          return NextResponse.json(
            {
              error: `No se puede aplicar 'receive': ${rpcError.message}`,
            },
            { status: 409 }
          );
        }
        if (rpcError.code === "42501") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        console.error("admin/purchase-orders/[id]/approve receive_purchase_order error:", rpcError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      // Releemos la fila completa de la PO para devolver el mismo shape que
      // el resto de las acciones (purchaseOrder completo, no solo el
      // resumen que retorna la RPC).
      const { data: updatedPo, error: refetchError } = await supabase
        .from("purchase_orders")
        .select()
        .eq("id", id)
        .single();

      if (refetchError) {
        console.error("admin/purchase-orders/[id]/approve refetch error:", refetchError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      return NextResponse.json(
        {
          purchaseOrder: updatedPo,
          action,
          linesUpdated:
            (rpcResult as { lines_updated?: number } | null)?.lines_updated ?? 0,
        },
        { status: 200 }
      );
    }

    const updatePayload: Record<string, unknown> = { status: transition.to };
    if (action === "approve") {
      updatePayload.approved_by = approver?.id || null;
      updatePayload.approved_at = new Date().toISOString();
    } else if (action === "mark_ordered") {
      updatePayload.ordered_at = new Date().toISOString();
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
      console.error("admin/purchase-orders/[id]/approve error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      {
        purchaseOrder: updated,
        action,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

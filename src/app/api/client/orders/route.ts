import { NextResponse } from "next/server";

import { ORDER_CLIENT_COLUMNS } from "@/lib/client-visible-columns";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
interface ChecklistZoneRow {
  sop_checklists: { zone: string; zone_label: string } | { zone: string; zone_label: string }[] | null;
}

/**
 * GET /api/client/orders — v8.3 E5: historial de servicios del cliente
 * autenticado, con las zonas reclamables de cada orden COMPLETADA (para
 * poblar el selector de "reportar un problema"). Usa ORDER_CLIENT_COLUMNS
 * (invariante B.2.3: el cliente nunca ve score/N/HHE/economía interna) — la
 * misma lista que ya existía para este propósito, solo que nunca se había
 * usado en una ruta real hasta ahora.
 */
export async function GET() {
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

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      // Fix (auditoría 2026-07-31, hallazgo #7 módulo cliente): se agrega
      // `total` al join de quotes -- ya está en QUOTE_CLIENT_COLUMNS (el
      // cliente puede ver el total de su propia cotización, invariante
      // B.2.3 solo excluye economía INTERNA como score/margen), y la
      // billetera lo necesita para mostrar cuánto crédito se aplicaría
      // ANTES de que el cliente confirme "Apply credit" (antes no se
      // mostraba ningún monto, el cliente aplicaba a ciegas).
      `${ORDER_CLIENT_COLUMNS}, hold_captured_at, capture_captured_at, quotes:quote_id (service_category, service_subtype, service_type, address, zone, total)`
    )
    .eq("user_id", user.id)
    .order("service_date", { ascending: false });

  if (error) {
    console.error("client/orders fetch error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  // v8.3 E2.10: booleano derivado, NUNCA se exponen los timestamps crudos de
  // Stripe (hold_captured_at/capture_captured_at no están en
  // ORDER_CLIENT_COLUMNS a propósito) -- solo si la orden todavía admite
  // aplicar crédito de billetera (ver /api/client/wallet/apply).
  const canApplyWalletCreditByOrder = new Map<string, boolean>();
  for (const o of (orders || []) as { id: string; hold_captured_at: string | null; capture_captured_at: string | null; wallet_amount_used_cents: number }[]) {
    canApplyWalletCreditByOrder.set(
      o.id,
      !o.hold_captured_at && !o.capture_captured_at && !o.wallet_amount_used_cents
    );
  }

  const completedOrderIds = (orders || [])
    .filter((o: { status: string }) => o.status === "completed")
    .map((o: { id: string }) => o.id);

  // Zonas reales del checklist de CADA orden completada (no el catálogo
  // genérico por subtipo — refleja exactamente lo que se limpió, incluyendo
  // add-ons). Mismo criterio que _shared.ts del lado admin.
  const zonesByOrder = new Map<string, { zone: string; zoneLabel: string }[]>();
  if (completedOrderIds.length > 0) {
    const { data: checklistRows, error: checklistError } = await supabase
      .from("service_checklist_items")
      .select("order_id, sop_checklists(zone, zone_label)")
      .in("order_id", completedOrderIds);

    if (checklistError) {
      console.error("client/orders checklist fetch error:", checklistError);
    } else {
      for (const row of (checklistRows as (ChecklistZoneRow & { order_id: string })[]) || []) {
        const sop = Array.isArray(row.sop_checklists) ? row.sop_checklists[0] : row.sop_checklists;
        if (!sop?.zone) continue;
        const existing = zonesByOrder.get(row.order_id) || [];
        if (!existing.some((z) => z.zone === sop.zone)) {
          existing.push({ zone: sop.zone, zoneLabel: sop.zone_label });
        }
        zonesByOrder.set(row.order_id, existing);
      }
    }
  }

  const ordersWithZones = (orders || []).map((o: { id: string; status: string; hold_captured_at?: string | null; capture_captured_at?: string | null }) => {
    const { hold_captured_at, capture_captured_at, ...rest } = o;
    void hold_captured_at;
    void capture_captured_at;
    return {
      ...rest,
      claimableZones: o.status === "completed" ? zonesByOrder.get(o.id) || [] : [],
      canApplyWalletCredit: canApplyWalletCreditByOrder.get(o.id) ?? false,
    };
  });

  return NextResponse.json({ orders: ordersWithZones }, { status: 200 });
}

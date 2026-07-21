import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ORDER_CLIENT_COLUMNS } from "@/lib/client-visible-columns";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

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
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `${ORDER_CLIENT_COLUMNS}, hold_captured_at, capture_captured_at, quotes:quote_id (service_category, service_subtype, service_type, address, zone)`
    )
    .eq("user_id", user.id)
    .order("service_date", { ascending: false });

  if (error) {
    console.error("client/orders fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
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

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeClientSegment, type ClientSegment } from "@/lib/client-segmentation";

/**
 * GET /api/admin/client-segments — v8.3 E5.14: clasifica cada cliente en
 * VIP / Regular / Esporádico / En riesgo / Nuevo (src/lib/client-segmentation.ts).
 *
 * `client_profiles.services_count` ya se mantiene por trigger (migración
 * 027) -- se reutiliza en vez de recalcularlo. El gasto mensual y la fecha
 * del último servicio SÍ se calculan aquí desde `orders` porque no existe
 * ninguna columna que los agregue todavía.
 *
 * Recurso RBAC: 'finance' (owner_admin) -- el gasto por cliente es
 * información financiera.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  const { data: profiles, error: profilesError } = await supabase
    .from("client_profiles")
    .select("user_id, services_count, account_type")
    .eq("account_type", "b2c"); // B2C solamente -- B2B/Gob tienen su propio ciclo de cuenta (E10, diferido)
  if (profilesError) {
    console.error("admin/client-segments error:", profilesError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: completedOrders, error: ordersError } = await supabase
    .from("orders")
    .select("user_id, service_date, total_paid_cents")
    .eq("status", "completed")
    .order("service_date", { ascending: false });
  if (ordersError) {
    console.error("admin/client-segments error:", ordersError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const lastServiceByClient = new Map<string, string>();
  const monthlySpendByClient = new Map<string, number>();
  // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents ya está en
  // centavos -- sin *100.
  for (const o of completedOrders || []) {
    if (!lastServiceByClient.has(o.user_id)) {
      lastServiceByClient.set(o.user_id, o.service_date);
    }
    if (o.service_date >= thirtyDaysAgo) {
      monthlySpendByClient.set(o.user_id, (monthlySpendByClient.get(o.user_id) || 0) + Math.round(o.total_paid_cents || 0));
    }
  }

  const nowMs = Date.now();
  const clients = (profiles || []).map((p) => {
    const lastServiceStr = lastServiceByClient.get(p.user_id);
    const daysSinceLastService = lastServiceStr
      ? Math.floor((nowMs - new Date(`${lastServiceStr}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24))
      : Infinity;
    const monthlySpendCents = monthlySpendByClient.get(p.user_id) || 0;
    const segment = computeClientSegment({
      monthlySpendCents,
      totalServicesCount: p.services_count || 0,
      daysSinceLastService,
    });
    return {
      userId: p.user_id,
      totalServicesCount: p.services_count || 0,
      monthlySpendCents,
      daysSinceLastService: Number.isFinite(daysSinceLastService) ? daysSinceLastService : null,
      segment,
    };
  });

  const counts: Record<ClientSegment, number> = { vip: 0, regular: 0, sporadic: 0, at_risk: 0, new: 0 };
  for (const c of clients) counts[c.segment]++;

  return NextResponse.json({ clients, counts }, { status: 200 });
}

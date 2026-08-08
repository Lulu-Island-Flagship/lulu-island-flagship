import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { assignVariant, isProtectedRecurringClient, type VariantConfig } from "@/lib/ab-experiments";
import { computeClientSegment } from "@/lib/client-segmentation";

/**
 * POST /api/admin/experiments/[id]/assign — { clientUserId }
 *
 * Asigna (o devuelve la asignación ya existente -- mismo cliente siempre ve
 * la misma variante, regla dura) usando assignVariant(). Nunca usa grupo
 * demográfico para la asignación (el spec lo prohíbe).
 *
 * "isRecurring" (auditoría E10, fix): no basta con mirar
 * service_contracts.status='active' -- eso deja sin protección a cualquier
 * cliente VIP/Regular fiel que reserva a demanda sin contrato formal. Se
 * calcula como isProtectedRecurringClient(hasActiveContract, segment), OR
 * de ambas señales (src/lib/ab-experiments.ts + client-segmentation.ts),
 * igual que /api/admin/client-segments.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
  const { supabase } = auth;
  const { id: experimentId } = await params;

  const body = await request.json().catch(() => ({}));
  const clientUserId = body.clientUserId as string | undefined;
  if (!clientUserId) {
    return NextResponse.json({ error: "clientUserId es obligatorio" }, { status: 400 });
  }

  // Ya asignado antes: la bitácora es inmutable, se devuelve tal cual.
  const { data: existing } = await supabase
    .from("experiment_assignments")
    .select("*")
    .eq("experiment_id", experimentId)
    .eq("client_user_id", clientUserId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ assignment: existing, reused: true }, { status: 200 });
  }

  const { data: experiment, error: experimentError } = await supabase
    .from("experiments")
    .select("variants, status")
    .eq("id", experimentId)
    .single();
  if (experimentError || !experiment) {
    return NextResponse.json({ error: "Experimento no encontrado" }, { status: 404 });
  }
  if (experiment.status !== "running") {
    return NextResponse.json({ error: `El experimento no está corriendo (status: ${experiment.status})` }, { status: 400 });
  }

  const { count: activeContracts } = await supabase
    .from("service_contracts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", clientUserId)
    .eq("status", "active");
  const hasActiveContract = (activeContracts ?? 0) > 0;

  // Mismo cómputo de segmentación que /api/admin/client-segments (E5.14):
  // services_count viene de client_profiles (trigger, migración 027), gasto
  // mensual y último servicio se agregan aquí desde orders porque no hay
  // columna que los mantenga.
  const { data: profile } = await supabase
    .from("client_profiles")
    .select("services_count")
    .eq("user_id", clientUserId)
    .maybeSingle();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: completedOrders } = await supabase
    .from("orders")
    .select("service_date, total_paid_cents")
    .eq("user_id", clientUserId)
    .eq("status", "completed")
    .order("service_date", { ascending: false });

  const nowMs = Date.now();
  let daysSinceLastService = Infinity;
  let monthlySpendCents = 0;
  // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents ya está en
  // centavos -- sin *100.
  for (const o of completedOrders || []) {
    if (daysSinceLastService === Infinity && o.service_date) {
      daysSinceLastService = Math.floor((nowMs - new Date(`${o.service_date}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24));
    }
    if (o.service_date && o.service_date >= thirtyDaysAgo) {
      monthlySpendCents += Math.round(o.total_paid_cents || 0);
    }
  }

  const segment = computeClientSegment({
    monthlySpendCents,
    totalServicesCount: profile?.services_count || 0,
    daysSinceLastService,
  });

  const isRecurring = isProtectedRecurringClient(hasActiveContract, segment);

  const result = assignVariant(
    { clientId: clientUserId, isRecurring },
    experiment.variants as VariantConfig[]
  );

  const { data: inserted, error: insertError } = await supabase
    .from("experiment_assignments")
    .insert({
      experiment_id: experimentId,
      client_user_id: clientUserId,
      variant: result.variant,
      excluded_reason: result.excludedReason ?? null,
    })
    .select()
    .single();

  if (insertError) {
    console.error("admin/experiments/[id]/assign error:", insertError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ assignment: inserted, reused: false }, { status: 201 });
}

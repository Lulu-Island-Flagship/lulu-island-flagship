import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { assignVariant, type VariantConfig } from "@/lib/ab-experiments";

/**
 * POST /api/admin/experiments/[id]/assign — { clientUserId }
 *
 * Asigna (o devuelve la asignación ya existente -- mismo cliente siempre ve
 * la misma variante, regla dura) usando assignVariant(). Determina
 * "isRecurring" consultando service_contracts activos del cliente; nunca
 * usa grupo demográfico para la asignación (el spec lo prohíbe).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
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
  const isRecurring = (activeContracts ?? 0) > 0;

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

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json({ assignment: inserted, reused: false }, { status: 201 });
}

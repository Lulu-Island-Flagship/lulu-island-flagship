import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluateExperimentWinner, type VariantOutcome, type ExperimentType } from "@/lib/ab-experiments";

/**
 * POST /api/admin/experiments/[id]/evaluate — { outcomes: VariantOutcome[], confidence }
 *
 * `confidence` se calcula fuera de esta ruta (z-test u otro método
 * estadístico -- fuera del alcance de este sistema por ahora, ver
 * comentario en ab-experiments.ts) y se recibe ya calculado. Si hay ganador,
 * marca el experimento 'completed'; si no, lo deja 'running' con el motivo.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  const { id: experimentId } = await params;

  const body = await request.json().catch(() => ({}));
  const outcomes = body.outcomes as VariantOutcome[] | undefined;
  const confidence = body.confidence as number | undefined;
  if (!Array.isArray(outcomes) || outcomes.length === 0 || confidence === undefined) {
    return NextResponse.json({ error: "outcomes (array) y confidence son obligatorios" }, { status: 400 });
  }

  const { data: experiment, error: experimentError } = await supabase
    .from("experiments")
    .select("experiment_type")
    .eq("id", experimentId)
    .single();
  if (experimentError || !experiment) {
    return NextResponse.json({ error: "Experimento no encontrado" }, { status: 404 });
  }

  const result = evaluateExperimentWinner(outcomes, experiment.experiment_type as ExperimentType, confidence);

  if (result.hasWinner) {
    const { data: updated, error: updateError } = await supabase
      .from("experiments")
      .update({
        status: "completed",
        winner: result.winner,
        winner_reason: result.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", experimentId)
      .select()
      .single();
    if (updateError) {
      console.error("admin/experiments/[id]/evaluate error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ result, experiment: updated }, { status: 200 });
  }

  return NextResponse.json({ result }, { status: 200 });
}

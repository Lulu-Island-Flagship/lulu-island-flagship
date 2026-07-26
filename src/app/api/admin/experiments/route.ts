import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { validateVariantWeights, type VariantConfig, type ExperimentType } from "@/lib/ab-experiments";

const EXPERIMENT_TYPES: ExperimentType[] = ["price", "copy", "ui_ux", "batch_schedule"];

// GET /api/admin/experiments — listar experimentos.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("experiments")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("admin/experiments error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ experiments: data || [] }, { status: 200 });
}

interface Body {
  action?: string;
  id?: string;
  name?: string;
  experimentType?: ExperimentType;
  variants?: VariantConfig[];
}

// POST /api/admin/experiments — { action: "create", name, experimentType, variants } | { action: "start", id }
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.action === "create") {
    if (!body.name || !body.experimentType || !EXPERIMENT_TYPES.includes(body.experimentType)) {
      return NextResponse.json({ error: `name y experimentType (${EXPERIMENT_TYPES.join(", ")}) son obligatorios` }, { status: 400 });
    }
    if (!Array.isArray(body.variants)) {
      return NextResponse.json({ error: "variants debe ser un array" }, { status: 400 });
    }

    const validation = validateVariantWeights(body.variants);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("experiments")
      .insert({
        name: body.name.trim(),
        experiment_type: body.experimentType,
        variants: body.variants,
        status: "draft",
      })
      .select()
      .single();

    if (error) {
      console.error("admin/experiments error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ experiment: data }, { status: 201 });
  }

  if (body.action === "start") {
    if (!body.id) return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
    const { data, error } = await supabase
      .from("experiments")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .select()
      .single();
    if (error) {
      console.error("admin/experiments error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ experiment: data }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}

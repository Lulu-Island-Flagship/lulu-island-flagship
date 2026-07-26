import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * v8.3 E0-C4 — API del panel de feature flags (wireframe aprobado por el dueño).
 * GET:   lista de flags agrupables por módulo. Solo owner_admin.
 * PATCH: enciende/apaga un flag por nombre. Solo owner_admin.
 *        Queda en admin_action_logs vía requireAdminRole (método != GET).
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("feature_flags", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("feature_flags")
    .select("nombre, activo, modulo, descripcion, es_critico, updated_at")
    .is("deleted_at", null)
    .order("modulo", { ascending: true })
    .order("nombre", { ascending: true });

  if (error) {
    console.error("admin/feature-flags error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ flags: data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole("feature_flags", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { nombre?: string; activo?: boolean; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.nombre || typeof body.activo !== "boolean") {
    return NextResponse.json(
      { error: "Se requiere { nombre: string, activo: boolean }" },
      { status: 400 }
    );
  }

  // Resolver el id del flag y actualizar vía RPC auditado (E0-C6):
  // motivo obligatorio + snapshot inmutable + undo posible.
  const { data: flagRow, error: findError } = await auth.supabase
    .from("feature_flags")
    .select("id")
    .eq("nombre", body.nombre)
    .is("deleted_at", null)
    .single();

  if (findError || !flagRow) {
    return NextResponse.json({ error: `Flag '${body.nombre}' no existe` }, { status: 404 });
  }

  const reason =
    body.reason?.trim() ||
    `Panel de flags: '${body.nombre}' ${body.activo ? "encendido" : "apagado"} manualmente`;

  const { data, error } = await auth.supabase.rpc("admin_update_config", {
    p_table: "feature_flags",
    p_id: flagRow.id,
    p_changes: { activo: body.activo, updated_by: auth.user.id },
    p_reason: reason,
  });

  if (error) {
    console.error("admin/feature-flags error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ flag: data });
}

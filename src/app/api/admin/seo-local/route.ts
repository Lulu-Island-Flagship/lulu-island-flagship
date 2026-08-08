import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient, logAdminAction } from "@/lib/admin";
import { computeAllGbpItemStatuses, isNapCheckOverdue, type GbpFrequency } from "@/lib/gbp-checklist";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/seo-local — checklist GBP con estado calculado + última
// verificación NAP y si está vencida (E10.3).
//
// POST /api/admin/seo-local — dos acciones:
//   { action: "complete_item", itemKey } — marca un ítem del checklist como
//     completado ahora, por el admin autenticado.
//   { action: "record_nap_check", directoriesChecked, isConsistent, inconsistenciesFound? }
//     — registra una verificación NAP manual (trimestral).
//
// Resource "finance": mismo bucket que attribution/partners/experiments —
// no existe un recurso "marketing" dedicado en admin-rbac.ts.
//
// v8.3 E11 (auditoría 2026-07-18): gbp_checklist_items y
// nap_consistency_checks tienen RLS `USING (false)` (migración 161) -- solo
// accesibles vía service role. requireAdminRole() sigue autorizando (rol +
// audit log), pero las operaciones de datos usan el cliente service role.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (service role)" }, { status: 500 });
  }

  const { data: items, error: itemsError } = await supabase
    .from("gbp_checklist_items")
    .select("item_key, label, frequency, last_completed_at, notes")
    .is("deleted_at", null)
    .order("frequency");
  if (itemsError) {
    console.error("admin/seo-local error:", itemsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const withStatus = computeAllGbpItemStatuses(
    (items || []).map((i: { item_key: string; frequency: GbpFrequency; last_completed_at: string | null }) => ({
      itemKey: i.item_key,
      frequency: i.frequency,
      lastCompletedAt: i.last_completed_at,
    })),
    nowIso
  );

  const { data: lastNapCheck } = await supabase
    .from("nap_consistency_checks")
    .select("*")
    .is("deleted_at", null)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(
    {
      items: withStatus.map((s, idx) => ({ ...s, label: (items || [])[idx]?.label, notes: (items || [])[idx]?.notes })),
      lastNapCheck: lastNapCheck || null,
      napCheckOverdue: isNapCheckOverdue(lastNapCheck?.checked_at ?? null, nowIso),
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { user } = auth;
  if (!auth.supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
  const supabase = getServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (service role)" }, { status: 500 });
  }

  // Fix (revisión 2026-07-30, punto 11): request.json() sin try/catch --
  // mismo patrón ya usado en src/app/api/admin/marketing/route.ts.
  let body: {
    action?: string;
    itemKey?: string;
    directoriesChecked?: unknown;
    isConsistent?: boolean;
    inconsistenciesFound?: unknown;
  };
  try {
    body = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 400, "JSON inválido");
  }

  if (body.action === "complete_item") {
    if (!body.itemKey) {
      return NextResponse.json({ error: "itemKey requerido" }, { status: 400 });
    }
    const { error } = await supabase
      .from("gbp_checklist_items")
      .update({ last_completed_at: new Date().toISOString(), last_completed_by: user?.id ?? null, updated_at: new Date().toISOString() })
      .eq("item_key", body.itemKey)
      .is("deleted_at", null);
    if (error) {
      console.error("admin/seo-local error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (body.action === "record_nap_check") {
    if (typeof body.isConsistent !== "boolean") {
      return NextResponse.json({ error: "isConsistent (boolean) requerido" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("nap_consistency_checks")
      .insert({
        checked_by: user?.id ?? null,
        directories_checked: body.directoriesChecked || [],
        is_consistent: body.isConsistent,
        inconsistencies_found: body.inconsistenciesFound ?? null,
      })
      .select()
      .single();
    if (error) {
      console.error("admin/seo-local error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ napCheck: data }, { status: 201 });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}

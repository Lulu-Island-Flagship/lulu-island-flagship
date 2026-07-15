import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { evaluateSuccessionStatus } from "@/lib/succession";

/**
 * POST /api/cron/succession-check
 *
 * v8.3 E11 (D.11.1) — Modo Sucesión. `evaluateSuccessionStatus()` (función
 * pura, 10/10 tests) existía desde el 9 de julio junto con las tablas
 * `succession_status`/`trusted_successors` (migración 050), pero nada las
 * conectaba: ni un cron que evaluara, ni una API/UI para verlo. Este cron
 * corre diario y es el único que ESCRIBE succession_status.
 *
 * Señal de "engagement operativo real": admin_action_logs con
 * role_used='owner_admin' (E0-C3, invariante: solo escrituras, nunca
 * GET/HEAD -- ver admin.ts). La fecha base cuando nunca hubo ninguna acción
 * es la de otorgamiento del rol owner_admin (admin_roles.created_at), no la
 * fecha de creación de la cuenta de auth (no accesible sin permisos extra
 * y, en la práctica, el rol se otorga el mismo día que se crea la cuenta
 * real del dueño).
 *
 * Umbrales (D.11.1, ya en succession.ts): 10 días = alerta de burnout
 * (suave), 14 días = alerta de sucesión, 21 días = activación automática.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const bearer = authHeader?.replace("Bearer ", "");
  if (bearer !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: ownerRoles, error: rolesError } = await supabase
      .from("admin_roles")
      .select("created_at")
      .eq("role", "owner_admin")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);

    if (rolesError) {
      return NextResponse.json({ error: rolesError.message }, { status: 500 });
    }
    if (!ownerRoles || ownerRoles.length === 0) {
      // No debería pasar nunca (invariante: nunca sin owner_admin, ver
      // prevent_removing_last_owner_admin en migración 050), pero si pasa
      // no tiene sentido evaluar sucesión de un dueño que no existe.
      return NextResponse.json({ skipped: true, reason: "No owner_admin found" }, { status: 200 });
    }
    const accountCreatedIso = ownerRoles[0].created_at as string;

    const { data: writeActions, error: actionsError } = await supabase
      .from("admin_action_logs")
      .select("created_at")
      .eq("role_used", "owner_admin")
      .order("created_at", { ascending: false })
      .limit(1);

    if (actionsError) {
      return NextResponse.json({ error: actionsError.message }, { status: 500 });
    }

    const lastEngagementIso: string | null = writeActions && writeActions.length > 0
      ? (writeActions[0].created_at as string)
      : null;

    const nowIso = new Date().toISOString();
    const evaluation = evaluateSuccessionStatus(lastEngagementIso, accountCreatedIso, nowIso);

    // No pisar una activación manual ya en curso (incapacidad/fallecimiento
    // certificados vía POST /api/admin/succession) -- esas son decisiones
    // humanas irreversibles por este cron.
    const { data: currentStatusRow } = await supabase
      .from("succession_status")
      .select("id, status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentStatusRow?.status === "manually_activated") {
      return NextResponse.json(
        { skipped: true, reason: "manually_activated -- cron never overrides a human-certified activation" },
        { status: 200 }
      );
    }

    const update: Record<string, unknown> = {
      status: evaluation.status,
      last_evaluated_at: nowIso,
    };
    if (evaluation.status === "auto_activate" && currentStatusRow?.status !== "auto_activate") {
      update.activated_at = nowIso;
      update.activated_reason = `Activación automática: ${Math.floor(evaluation.daysSinceEngagement)} días sin engagement operativo real del owner_admin (umbral: 21 días).`;
    }

    if (currentStatusRow) {
      await supabase.from("succession_status").update(update).eq("id", currentStatusRow.id);
    } else {
      await supabase.from("succession_status").insert(update);
    }

    return NextResponse.json(
      { status: evaluation.status, daysSinceEngagement: Math.floor(evaluation.daysSinceEngagement) },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


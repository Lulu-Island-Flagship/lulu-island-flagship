import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/cron/pipeda-purge — v8.3 fix E-B5 (auditoría RBAC/compliance
 * 2026-07-21): "`purge_eligible_at` se escribe y ningún job lo consume."
 *
 * `purge_eligible_at` se fija hoy en admin/pipeda/requests/[id]/route.ts
 * cuando una solicitud de tipo 'deletion' se marca `completed` (soft-delete
 * en cascada + 2 años de retención fiscal, `computePurgeEligibleAt` en
 * src/lib/pipeda.ts). Ese endpoint documenta explícitamente que "el purge
 * FÍSICO... no ocurre aquí ni en ningún cron existente hoy". Este cron es
 * ese job, con el mismo límite de alcance declarado ahí, a propósito:
 *
 *   NO hace DELETE físico de nada. El patrón del repo es soft-delete
 *   (`deleted_at`) con `prevent_hard_delete()` en la mayoría de tablas
 *   (incluida `data_subject_requests`, migración 142:44-45) -- un DELETE
 *   real aquí violaría ese trigger en la mayoría de casos, y para las
 *   tablas que no lo tienen (p.ej. Storage) sería un borrado destructivo
 *   nuevo que nadie pidió expresamente en el hallazgo. Lo que SÍ hace este
 *   cron: confirma que la cascada de soft-delete (E-B5) ya se aplicó de
 *   verdad para el titular de la solicitud, y si es así, marca
 *   `purged_at = now()` -- el registro de que la ventana de retención se
 *   cumplió y fue verificada, que es lo que hoy falta por completo (antes
 *   de este archivo, `purged_at` no lo escribía nada).
 *
 * Si la cascada NO se verifica completa (p.ej. `client_profiles` sin
 * `deleted_at`, señal de que el `complete` original falló o la cascada tuvo
 * errores parciales -- ver el `cascadeErrors` de
 * admin/pipeda/requests/[id]/route.ts:163-172), la solicitud se deja sin
 * marcar y se reporta en `skipped` para que compliance la revise a mano en
 * vez de purgarla a ciegas.
 *
 * Seguridad: mismo patrón que el resto de crons del repo -- header
 * Authorization: Bearer ${CRON_SECRET} (ver
 * src/app/api/cron/photo-retention-purge/route.ts:32-41).
 */
export async function GET(request: NextRequest) {
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
  const nowIso = new Date().toISOString();

  let purged = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    // Solo solicitudes de eliminación ya completadas (la cascada de
    // soft-delete solo se dispara al completar, ver [id]/route.ts:99-173),
    // con la ventana de retención cumplida, y que este cron no haya
    // procesado todavía.
    const { data: eligible, error: fetchError } = await supabase
      .from("data_subject_requests")
      .select("id, client_user_id, status, request_type, purge_eligible_at, purged_at")
      .eq("request_type", "deletion")
      .eq("status", "completed")
      .is("purged_at", null)
      .is("deleted_at", null)
      .lte("purge_eligible_at", nowIso);

    if (fetchError) throw fetchError;

    for (const reqRow of eligible || []) {
      // Confirma que la cascada de soft-delete de E-B5 se aplicó de verdad
      // para este titular antes de dar la solicitud por purgada -- no basta
      // con confiar en que `status === 'completed'` implique que la
      // cascada tuvo éxito (puede haber tenido errores parciales, ver
      // `cascadeErrors` en admin/pipeda/requests/[id]/route.ts).
      const { data: clientProfile, error: profileError } = await supabase
        .from("client_profiles")
        .select("id, deleted_at")
        .eq("user_id", reqRow.client_user_id)
        .maybeSingle();

      if (profileError) {
        errors.push(`request ${reqRow.id}: ${profileError.message}`);
        continue;
      }

      // Sin fila en client_profiles ya es "no hay nada que retener" (el
      // titular nunca tuvo perfil de cliente completo); con fila, exige que
      // el soft-delete central se haya aplicado.
      const cascadeConfirmed = !clientProfile || Boolean(clientProfile.deleted_at);

      if (!cascadeConfirmed) {
        skipped++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("data_subject_requests")
        .update({ purged_at: nowIso })
        .eq("id", reqRow.id)
        .is("purged_at", null);

      if (updateError) {
        errors.push(`request ${reqRow.id}: ${updateError.message}`);
        continue;
      }
      purged++;
    }

    return NextResponse.json(
      { purged, skipped, errors: errors.length > 0 ? errors : undefined },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

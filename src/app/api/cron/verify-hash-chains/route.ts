import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyHashChain } from "@/lib/legal-monitoring";
import { publishUnifiedAlert } from "@/lib/unified-alerts";

/**
 * GET /api/cron/verify-hash-chains — v8.3 E9.4/E9.9.
 *
 * Bug real de auditoría: `verifyHashChain()` (src/lib/legal-monitoring.ts)
 * quedó definida y probada (tests/lib/legal-monitoring.test.ts) pero NADIE
 * la invocaba en producción -- el hash-chain de data_breach_incidents
 * (prev_hash/row_hash, migración 142, escrito en
 * /api/admin/pipeda/breach-incidents POST) se calculaba al insertar pero
 * nunca se recalculaba/verificaba después, así que una edición retroactiva
 * directa en la base (fuera de la API) pasaría desapercibida para siempre.
 *
 * Este cron recorre data_breach_incidents en orden de inserción real
 * (created_at, el mismo orden usado al encadenar en el POST) y reconstruye
 * el hash esperado de cada fila con el MISMO contenido canónico que usó el
 * POST al crearla (JSON.stringify({ description, affectedClientIds,
 * severity, detectedAt, loggedBy }) -- ver breach-incidents/route.ts). Si
 * alguna fila no cuadra, es evidencia de alteración retroactiva de un log
 * que se supone inmutable: se dispara una alerta P0 a la bandeja unificada
 * (unified_alerts) para que un humano investigue de inmediato.
 *
 * Frecuencia: diario (backup extra de la protección BEFORE DELETE de la
 * migración 142, que ya bloquea el borrado duro pero no una edición directa
 * de columnas vía acceso privilegiado a la base).
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}, mismo
 * patrón que el resto de los crons.
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

  try {
    const { data: rows, error } = await supabase
      .from("data_breach_incidents")
      .select("id, description, affected_client_ids, severity, detected_at, logged_by_admin, prev_hash, row_hash, created_at")
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reconstruye el mismo `content` canónico usado al insertar (ver
    // /api/admin/pipeda/breach-incidents POST) para poder recalcular cada
    // row_hash a partir del prev_hash guardado.
    const chainRows = (rows || []).map((r) => ({
      prevHash: r.prev_hash as string | null,
      content: JSON.stringify({
        description: r.description,
        affectedClientIds: r.affected_client_ids,
        severity: r.severity,
        detectedAt: r.detected_at,
        loggedBy: r.logged_by_admin,
      }),
      rowHash: r.row_hash as string,
    }));

    const result = verifyHashChain(chainRows);

    if (!result.valid) {
      const brokenRow = rows?.[result.brokenAtIndex ?? 0];
      await publishUnifiedAlert(supabase, {
        sourceModule: "hash_chain_verification",
        sourceTable: "data_breach_incidents",
        sourceId: brokenRow?.id as string | undefined,
        tier: "respond_10min",
        severity: "p0_safety",
        title: "Cadena de hash rota en data_breach_incidents (posible alteración retroactiva de un log inmutable)",
        summary: `Discrepancia detectada en la fila #${result.brokenAtIndex} (id ${brokenRow?.id ?? "desconocido"}) de ${chainRows.length}. El hash recalculado no coincide con row_hash almacenado -- investigar de inmediato.`,
      });
    }

    return NextResponse.json(
      { checkedRows: chainRows.length, valid: result.valid, brokenAtIndex: result.brokenAtIndex },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

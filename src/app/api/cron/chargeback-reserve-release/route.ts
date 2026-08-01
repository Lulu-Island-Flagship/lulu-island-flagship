import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVancouverTodayString } from "@/lib/date-utils";
import { requireCronAuth } from "@/lib/cron-auth";

/**
 * GET /api/cron/chargeback-reserve-release
 *
 * v8.3 AUDITORÍA RESERVA→DINERO→RESEÑA — hallazgo real: chargeback_reserves
 * (migración 024) siempre se creaba con status='held' y un release_date
 * (~180 días después), y la migración incluso incluye un índice pensado
 * exactamente para esta consulta (idx_chargeback_reserves_release_date),
 * pero ningún cron ni código en todo el repo lo leía -- ninguna reserva
 * jamás transicionaba a 'released'. El dinero quedaba retenido para
 * siempre en los reportes de exposición de caja, nunca volvía a estar
 * disponible aunque el riesgo de chargeback ya hubiera pasado.
 *
 * Este cron corre diario: toda reserva 'held' cuyo release_date ya pasó Y
 * cuya orden no tiene un chargeback en curso (orders.warranty_status
 * distinto de 'escalated' -- ver handleDisputeCreated en el webhook de
 * Stripe, que marca 'escalated' al abrirse una disputa) se libera. Si la
 * orden SÍ tiene una disputa activa, se deja para el día siguiente --
 * cuando esa disputa se cierre, el webhook de Stripe (handleDisputeClosed)
 * ya la aplica o libera de inmediato sin esperar a este cron.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const todayStr = getVancouverTodayString();

    const { data: dueReserves, error } = await supabase
      .from("chargeback_reserves")
      .select("id, order_id, reserve_amount, released_amount, status")
      .in("status", ["held", "partially_released"])
      .not("release_date", "is", null)
      .lte("release_date", todayStr);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let released = 0;
    let skippedActiveDispute = 0;
    const errors: { reserveId: string; error: string }[] = [];

    for (const reserve of dueReserves || []) {
      try {
        const { data: order } = await supabase
          .from("orders")
          .select("warranty_status")
          .eq("id", reserve.order_id)
          .maybeSingle();

        // 'escalated' = disputa de Stripe abierta y sin resolver todavía
        // (handleDisputeCreated). No liberar mientras el riesgo sigue vivo.
        if (order?.warranty_status === "escalated") {
          skippedActiveDispute++;
          continue;
        }

        const { error: updateError } = await supabase
          .from("chargeback_reserves")
          .update({
            status: "released",
            released_amount: reserve.reserve_amount,
            updated_at: new Date().toISOString(),
          })
          .eq("id", reserve.id);

        if (updateError) {
          errors.push({ reserveId: reserve.id, error: updateError.message });
          continue;
        }

        released++;
      } catch (err: Error | unknown) {
        errors.push({
          reserveId: reserve.id,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json(
      {
        date: todayStr,
        candidates: dueReserves?.length ?? 0,
        released,
        skippedActiveDispute,
        errors,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Chargeback reserve release error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

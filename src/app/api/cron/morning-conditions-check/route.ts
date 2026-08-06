import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { getMorningConditions, shouldNotifyClientOfDelay } from "@/lib/traffic-conditions-provider";
import { dispatchCommunication } from "@/lib/send-communication";
import { getVancouverTodayString } from "@/lib/date-utils";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/morning-conditions-check
 *
 * v8.3 E8.4 — "Clima y tráfico 6:00 AM": revisa condiciones por zona con
 * servicios programados hoy y, si el retraso estimado supera el umbral,
 * despacha el evento 'arrival_delayed' ya existente en el catálogo
 * (communication_events, migración 045) para cada orden de esa zona.
 *
 * Mientras no exista un proveedor real de clima/tráfico configurado
 * (getMorningConditions siempre devuelve 'not_configured' hoy, ver
 * traffic-conditions-provider.ts), este cron corre, evalúa cada zona, no
 * encuentra nada que notificar y termina limpio — el punto de conexión real
 * ya existe para cuando se contrate el proveedor, en vez de tener que
 * construirlo desde cero más adelante.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}.
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
    const today = getVancouverTodayString();

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, quotes:quote_id ( user_id, zone, address )")
      .eq("service_date", today)
      .not("status", "in", "(cancelled,no_show,completed)");

    if (ordersError) {
      console.error("ordersError:", ordersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    type OrderRow = { id: string; quotes: { user_id: string; zone: string; address: string } | null };
    const typedOrders = (orders ?? []) as unknown as OrderRow[];

    const zones = Array.from(new Set(typedOrders.map((o) => o.quotes?.zone).filter((z): z is string => Boolean(z))));

    let notified = 0;
    const zoneResults: Record<string, string> = {};

    for (const zone of zones) {
      const conditions = await getMorningConditions({ zone, date: today });
      zoneResults[zone] = conditions.status;

      if (conditions.status !== "ok") continue; // honesto: sin proveedor, no hay nada que evaluar

      if (shouldNotifyClientOfDelay(conditions.estimatedDelayMinutes)) {
        const ordersInZone = typedOrders.filter((o) => o.quotes?.zone === zone);
        for (const order of ordersInZone) {
          const quote = order.quotes;
          if (!quote?.user_id) continue;
          await dispatchCommunication(supabase, {
            eventKey: "arrival_delayed",
            userId: quote.user_id,
            orderId: order.id,
            language: "en",
            vars: { delay_minutes: String(conditions.estimatedDelayMinutes ?? "") },
          });
          notified += 1;
        }
      }
    }

    return NextResponse.json({ zonesEvaluated: zones.length, zoneResults, notified }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

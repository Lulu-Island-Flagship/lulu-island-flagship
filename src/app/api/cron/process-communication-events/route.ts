import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/process-communication-events
 *
 * v8.3 Capa 2 — Cron de procesamiento de eventos de comunicación.
 *
 * Consume la cola communication_events (eventos publicados vía
 * publishEvent en src/lib/communication-events.ts) y los despacha
 * según su event_type.
 *
 * Por ahora es un stub: solo registra cada evento en el log del servidor
 * y los marca como procesados. El despacho real (vía dispatchCommunication
 * de src/lib/send-communication.ts) se cableará en una fase posterior
 * cuando el mapeo event_type → event_key esté definido.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}.
 */
export async function GET(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Obtener todos los eventos no procesados, ordenados FIFO.
    const { data: events, error: fetchError } = await supabase
      .from("communication_events")
      .select("id, event_type, business_object_type, business_object_id, payload, processed, created_at")
      .eq("processed", false)
      .order("created_at", { ascending: true });

    if (fetchError) {
      console.error("process-communication-events fetch error:", fetchError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (!events || events.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let processed = 0;

    for (const event of events) {
      // Stub: loguear el evento y marcarlo como procesado.
      // Cuando se cablee el despacho real, aquí se mapeará event_type
      // al event_key correspondiente y se llamará a dispatchCommunication.
      console.log(
        `[process-communication-events] event_type=${event.event_type} ` +
        `business_object_type=${event.business_object_type} ` +
        `business_object_id=${event.business_object_id} ` +
        `id=${event.id}`
      );

      // TODO: Cablear dispatchCommunication aquí.
      // Ejemplo futuro:
      // if (event.event_type === "order_confirmed") {
      //   await dispatchCommunication(supabase, {
      //     eventKey: "order_confirmed",
      //     userId: (event.payload as any).user_id,
      //     orderId: event.business_object_id,
      //     language: (event.payload as any).language ?? "en",
      //     vars: event.payload as Record<string, string | number>,
      //   });
      // }

      const { error: markError } = await supabase
        .from("communication_events")
        .update({ processed: true })
        .eq("id", event.id);

      if (markError) {
        console.error(
          `process-communication-events mark error for event ${event.id}:`,
          markError
        );
        // Continuar con el siguiente evento; no detener el lote.
        continue;
      }

      processed += 1;
    }

    return NextResponse.json({ processed });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { reconcileCapturedPaymentIntent } from "@/lib/payment-capture-reconciliation";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/cron/reconcile-payments
 *
 * v8.3 M-2 (auditoría implacable 2026-07-20b) — red de seguridad de
 * reconciliación de capturas de Stripe.
 *
 * Las 6 rutas que capturan pagos (force-full-capture, cancel,
 * batch-capture-retry, no-show, batch-capture x2) escriben el resultado en
 * `orders` de forma síncrona, en el mismo request que llama a
 * `stripe.paymentIntents.capture()` / `.create()`. Si esa respuesta HTTP se
 * pierde después de que Stripe efectivamente cobró (timeout, cold start
 * matado, etc.), la fila de `orders` queda "atascada" indicando que la
 * captura sigue pendiente cuando en realidad ya sucedió. El webhook
 * `payment_intent.succeeded` (src/app/api/stripe/webhook/route.ts) cubre el
 * caso feliz de que el evento llegue; este cron es el respaldo para cuando
 * incluso el webhook se hubiera perdido (o Stripe reintente antes de que se
 * reconfigure correctamente), consultando directamente a Stripe qué pasó de
 * verdad con cada PaymentIntent "sospechoso".
 *
 * "Sospechoso" = orden con stripe_hold_payment_intent_id seteado, status
 * 'completed' (ya pasó por el batch de las 7PM o por no-show) pero
 * hold_captured_at sigue null, y ya pasó el umbral de seguridad (30 min)
 * desde la última actualización -- evita falsos positivos sobre una orden
 * que está a mitad de un capture en curso ahora mismo.
 *
 * Reusa reconcileCapturedPaymentIntent (mismo módulo que el webhook) para no
 * duplicar el mapeo de campos en dos sitios.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 * (mismo patrón que src/app/api/cron/no-show/route.ts y
 * src/app/api/cron/batch-capture/route.ts).
 */

const SAFETY_THRESHOLD_MINUTES = 30;
const MAX_ORDERS_PER_RUN = 200;

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
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const stripe = assertStripe();
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const cutoffIso = new Date(Date.now() - SAFETY_THRESHOLD_MINUTES * 60 * 1000).toISOString();

  const results = {
    checked: 0,
    reconciled: 0,
    stillPending: 0,
    errors: [] as { orderId: string; error: string }[],
  };

  try {
    // Rama A: holds cuya captura pudo haberse perdido (stripe_hold_payment_intent_id
    // set, aún no reflejado localmente como capturado, orden ya no está en
    // estados donde un hold sin capturar es normal -- 'completed' o 'no_show'
    // son los dos únicos status donde este proyecto captura el hold).
    const { data: holdCandidates, error: holdError } = await supabase
      .from("orders")
      .select("id, stripe_hold_payment_intent_id")
      .in("status", ["completed", "no_show"])
      .not("stripe_hold_payment_intent_id", "is", null)
      .is("hold_captured_at", null)
      .lt("updated_at", cutoffIso)
      .limit(MAX_ORDERS_PER_RUN);

    if (holdError) {
      console.error("reconcile-payments: hold candidates fetch error:", holdError);
    }

    // Rama B: cobros de saldo/excedente que pudieron perderse -- orden ya
    // 'completed'/'no_show', con hold sí reflejado (o sin hold, caso PayPal),
    // pero capture_captured_at sigue null. Sin un ID de PaymentIntent de
    // saldo guardado localmente (justamente porque el write se perdió), no
    // hay forma de consultar a Stripe cuál PI corresponde -- Stripe no
    // ofrece "buscar por metadata.order_id" de forma directa y barata en
    // este SDK, así que esta rama se limita honestamente a los holds
    // (rama A), que sí tienen un ID conocido de antemano. Documentado como
    // limitación conocida, no un bug oculto: un cobro de SALDO perdido sin
    // que el hold también lo esté es un caso más raro (el saldo se cobra
    // en la misma función que ya escribió hold_captured_at exitosamente)
    // y quedaría solo cubierto por el webhook payment_intent.succeeded.

    for (const order of holdCandidates || []) {
      results.checked++;
      if (!order.stripe_hold_payment_intent_id) continue;

      try {
        const pi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);

        if (pi.status === "succeeded") {
          const reconciled = await reconcileCapturedPaymentIntent(supabase, {
            id: pi.id,
            amountReceivedCents: pi.amount_received ?? pi.amount ?? 0,
            orderId: pi.metadata?.order_id ?? order.id,
            chargeType: pi.metadata?.charge_type,
          });
          if (reconciled.updated) {
            results.reconciled++;
          } else {
            results.stillPending++;
          }
        } else {
          // Sigue sin capturar de verdad en Stripe (requires_capture, etc.)
          // -- no es un caso de reconciliación, es simplemente una captura
          // que aún no ha corrido o falló y espera reintento por otro cron.
          results.stillPending++;
        }
      } catch (err: Error | unknown) {
        const message = err instanceof Error ? err.message : "Unknown reconciliation error";
        results.errors.push({ orderId: order.id, error: message });
        console.error(`reconcile-payments: failed for order ${order.id}:`, err);
      }
    }

    return NextResponse.json(
      {
        success: true,
        ...results,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

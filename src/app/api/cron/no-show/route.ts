import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { assertStripe } from "@/lib/stripe";
import { dispatchCommunication } from "@/lib/send-communication";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { getVancouverTodayMidnight } from "@/lib/date-utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseAdmin = SupabaseClient<any, "public", any>;

/**
 * GET /api/cron/no-show
 *
 * Job programado cada 15 minutos (America/Vancouver).
 * Detecta no-shows del día (service_date = hoy Vancouver): orden confirmada cuya
 * hora de servicio + 30 min ya pasó y no tiene evento t_in.
 *
 * Flujo v8.2:
 *  1. Espera 30 min (posicionamiento premium).
 *  2. SMS inmediato al cliente con opciones.
 *  3. Sin respuesta: NO_SHOW confirmado.
 *  4. Captura el hold completo como penalidad.
 *  5. Garantiza Day Rate del equipo.
 *  6. Propone recuperación de tiempo muerto.
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

const NO_SHOW_GRACE_MINUTES = 30;

function getVancouverNow(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const h = parts.find((p) => p.type === "hour")?.value;
  const min = parts.find((p) => p.type === "minute")?.value;
  const s = parts.find((p) => p.type === "second")?.value;
  return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
}

function vancouverTodayString(): string {
  return getVancouverNow().toISOString().split("T")[0];
}

async function captureNoShowPenalty(
  stripe: ReturnType<typeof assertStripe>,
  supabase: SupabaseAdmin,
  order: {
    id: string;
    user_id: string;
    quote_id: string;
    payment_option: string;
    stripe_hold_payment_intent_id: string | null;
    hold_authorized_amount: number;
    hold_amount: number;
    paypal_advance_amount: number;
    stripe_customer_id: string | null;
    stripe_payment_method_id: string | null;
  },
  quoteTotal: number
): Promise<{ amountCharged: number; payments: { hold?: string; penalty?: string } }> {
  const result = { amountCharged: 0, payments: {} as { hold?: string; penalty?: string } };

  if (order.payment_option === "paypal_first_time") {
    // PayPal: el anticipo ya cubre el 50% del hold. Se cobra la diferencia hasta el hold completo.
    const paypalAdvance = Math.min(
      Math.max(0, order.paypal_advance_amount || Math.round(order.hold_amount * 0.5)),
      quoteTotal
    );
    const penaltyDue = Math.max(0, order.hold_amount - paypalAdvance);

    if (penaltyDue > 0) {
      if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
        throw new Error("Missing card registration for PayPal no-show penalty");
      }
      const penaltyPi = await stripe.paymentIntents.create(
        {
          amount: penaltyDue * 100,
          currency: "cad",
          customer: order.stripe_customer_id,
          payment_method: order.stripe_payment_method_id,
          payment_method_types: ["card"],
          capture_method: "automatic",
          confirm: true,
          off_session: true,
          description: `No-show penalty for PayPal order ${order.id}`,
          metadata: {
            order_id: order.id,
            quote_id: order.quote_id,
            user_id: order.user_id,
            charge_type: "paypal_no_show_penalty",
          },
        },
        { idempotencyKey: `${order.id}:no-show-paypal-penalty` }
      );
      if (penaltyPi.status !== "succeeded") {
        throw new Error(`PayPal no-show penalty PaymentIntent status: ${penaltyPi.status}`);
      }
      result.payments.penalty = penaltyPi.id;
      result.amountCharged += penaltyDue;
    }

    // Liberar cualquier hold autorizado (no debería existir, pero por seguridad)
    if (order.stripe_hold_payment_intent_id) {
      try {
        const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
        if (holdPi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(order.stripe_hold_payment_intent_id);
        }
      } catch (err) {
        console.warn(`Could not cancel hold for PayPal order ${order.id}:`, err);
      }
    }
  } else {
    // Tarjeta: capturar hold completo como penalidad.
    const holdAmount = Math.min(
      Math.max(0, order.hold_authorized_amount || order.hold_amount || 0),
      quoteTotal
    );
    if (holdAmount > 0) {
      if (!order.stripe_hold_payment_intent_id) {
        throw new Error("Missing hold PaymentIntent for card no-show");
      }
      const holdPi = await stripe.paymentIntents.retrieve(order.stripe_hold_payment_intent_id);
      if (holdPi.status === "requires_capture") {
        await stripe.paymentIntents.capture(
          order.stripe_hold_payment_intent_id,
          { amount_to_capture: holdAmount * 100 },
          { idempotencyKey: `${order.id}:no-show-hold-capture` }
        );
      } else if (holdPi.status !== "succeeded") {
        throw new Error(`Hold PaymentIntent status: ${holdPi.status}`);
      }
      result.payments.hold = order.stripe_hold_payment_intent_id;
      result.amountCharged += holdAmount;
    }
  }

  return result;
}

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
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
  const now = getVancouverNow();
  const today = vancouverTodayString();

  try {
    const { data: todaysOrders, error: ordersError } = await supabase
      .from("orders")
      .select(
        "id, quote_id, user_id, service_time, service_datetime, status, payment_option, stripe_hold_payment_intent_id, hold_authorized_amount, hold_amount, paypal_advance_amount, stripe_customer_id, stripe_payment_method_id, quotes(total)"
      )
      .eq("service_date", today)
      .eq("status", "confirmed");

    if (ordersError) throw ordersError;

    const detected: string[] = [];
    const recovered: string[] = [];
    const penalized: string[] = [];
    const errors: { orderId: string; error: string }[] = [];

    for (const order of todaysOrders || []) {
      const [h, m] = (order.service_time || "00:00").split(":").map(Number);
      const serviceTime = new Date(now);
      serviceTime.setHours(h, m, 0, 0);
      const graceEnd = new Date(serviceTime.getTime() + NO_SHOW_GRACE_MINUTES * 60 * 1000);

      if (now < graceEnd) continue; // aún dentro de la ventana de gracia

      // Verificar si ya hay t_in
      const { data: tInLogs } = await supabase
        .from("service_logs")
        .select("id")
        .eq("order_id", order.id)
        .eq("event_type", "t_in")
        .limit(1);

      if (tInLogs && tInLogs.length > 0) continue; // ya llegó

      // Verificar si ya fue detectado
      const { data: existingNoShow } = await supabase
        .from("no_show_logs")
        .select("id, status, client_notified_at, cause")
        .eq("order_id", order.id)
        .maybeSingle();

      const quoteTotal = Math.round(Number((order.quotes as unknown as { total: number }[] | null)?.[0]?.total ?? 0));

      if (!existingNoShow) {
        // Obtener assignment original
        const { data: assignments } = await supabase
          .from("assignments")
          .select("id, employee_id")
          .is("deleted_at", null)
          .eq("order_id", order.id)
          .limit(1);
        const assignment = assignments?.[0];

        // v8.3 fix (auditoría 2026-07-15): antes cualquier "sin t_in" se
        // trataba como ausencia del CLIENTE, sin distinguir el caso
        // contrario -- el equipo asignado nunca inició turno hoy. Cobrar
        // la penalidad de no-show a un cliente que esperó a un equipo que
        // nunca iba a llegar sería una penalidad injusta y una fuente
        // real de disputas/chargebacks. Se distingue revisando si el
        // empleado asignado registró jornada_start hoy.
        let cause: "client" | "employee" | "unknown" = "unknown";
        if (assignment?.employee_id) {
          const { data: jornadaLogs } = await supabase
            .from("service_logs")
            .select("id")
            .eq("employee_id", assignment.employee_id)
            .eq("event_type", "jornada_start")
            .gte("timestamp", getVancouverTodayMidnight().toISOString())
            .limit(1);
          cause = jornadaLogs && jornadaLogs.length > 0 ? "client" : "employee";
        }

        await supabase.from("no_show_logs").insert({
          order_id: order.id,
          employee_id: assignment?.employee_id,
          detected_at: now.toISOString(),
          grace_until: graceEnd.toISOString(),
          status: "waiting",
          cause,
          notes: `No-show detected after ${NO_SHOW_GRACE_MINUTES} min grace period (cause: ${cause})`,
        });

        // Marcar assignment como no_show
        if (assignment) {
          await supabase
            .from("assignments")
            .update({ status: "no_show", updated_at: now.toISOString() })
            .eq("id", assignment.id);
        }

        if (cause === "employee") {
          // No se penaliza al cliente ni se incrementa su contador de
          // no-shows -- el problema es de dotación de personal, no del
          // cliente. Se alerta a admin de inmediato para reasignación
          // urgente (tier respond_10min, mismo patrón que safety-abort).
          await publishUnifiedAlert(supabase, {
            sourceModule: "no_show_cron",
            sourceTable: "no_show_logs",
            sourceId: order.id,
            tier: "respond_10min",
            severity: "p1_urgent",
            title: "Employee no-show — team never started their shift",
            summary: `Order ${order.id}: assigned employee has no jornada_start logged today, ${NO_SHOW_GRACE_MINUTES}min past service time. Needs urgent reassignment. Client should NOT be penalized.`,
          });
        } else {
          // Incrementar contador de no-show del cliente (solo cuando el
          // empleado sí estaba activo, así que la ausencia es del cliente).
          await supabase.rpc("increment_no_show_count", { p_user_id: order.user_id });
        }

        detected.push(order.id);
      } else if (existingNoShow.cause === "employee") {
        // Ya alertado a admin en la detección inicial; este cron nunca
        // notifica al cliente ni cobra penalidad en este camino -- la
        // recuperación/reasignación es responsabilidad de admin desde la
        // alerta ya publicada. Solo se sale sin hacer nada más aquí.
        continue;
      } else if (existingNoShow.status === "waiting" && !existingNoShow.client_notified_at) {
        // v8.3 fix (auditoría 2026-07-15): antes esto solo marcaba
        // client_notified_at sin enviar NADA -- un placeholder de
        // "notificamos" que en realidad nunca notificaba (el console.log
        // vivía en la rama de detección inicial, un paso antes de este).
        // Ahora despacha el evento real 'no_show_notice' (catálogo +
        // plantilla en migración 181) ANTES de marcar client_notified_at,
        // para que ese campo refleje que sí se intentó notificar de verdad.
        try {
          const { data: clientProfile } = await supabase
            .from("client_profiles")
            .select("preferred_languages")
            .eq("user_id", order.user_id)
            .maybeSingle();
          const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
            | "en"
            | "zh"
            | "fr";
          await dispatchCommunication(supabase, {
            eventKey: "no_show_notice",
            userId: order.user_id,
            orderId: order.id,
            language,
            vars: {},
          });
        } catch (notifyErr) {
          console.error(`Failed to dispatch no_show_notice for order ${order.id}:`, notifyErr);
        }

        await supabase
          .from("no_show_logs")
          .update({ client_notified_at: now.toISOString(), updated_at: now.toISOString() })
          .eq("id", existingNoShow.id);
      } else if (existingNoShow.status === "waiting" && existingNoShow.client_notified_at) {
        // Cliente fue notificado previamente y no respondió → confirmar no-show + penalidad.
        try {
          const captureResult = await captureNoShowPenalty(stripe, supabase, order, quoteTotal);

          await supabase
            .from("orders")
            .update({
              status: "no_show",
              hold_captured_at: captureResult.payments.hold ? now.toISOString() : null,
              total_paid: (order.paypal_advance_amount || 0) + captureResult.amountCharged,
              card_amount_charged: captureResult.amountCharged,
              capture_last_error: null,
              updated_at: now.toISOString(),
            })
            .eq("id", order.id);

          await supabase
            .from("no_show_logs")
            .update({
              status: "unrecovered",
              notes: `No-show confirmed. Penalty charged: $${captureResult.amountCharged.toFixed(2)}`,
              updated_at: now.toISOString(),
            })
            .eq("id", existingNoShow.id);

          penalized.push(order.id);
        } catch (err: Error | unknown) {
          const message = err instanceof Error ? err.message : "Unknown penalty error";
          errors.push({ orderId: order.id, error: message });
          console.error(`No-show penalty failed for order ${order.id}:`, err);
        }
      } else if (existingNoShow.status === "unrecovered") {
        // Recuperación: intentar reasignar a cualquier empleado disponible
        const { data: availableEmployees } = await supabase
          .from("employees")
          .select("id")
          .eq("is_active", true)
          .in("role", ["cleaner", "supervisor"])
          .limit(1);

        const replacement = availableEmployees?.[0];
        if (replacement) {
          const { data: newAssignment } = await supabase
            .from("assignments")
            .insert({
              order_id: order.id,
              employee_id: replacement.id,
              status: "pending",
              notes: `Recovery assignment after no-show`,
            })
            .select("id")
            .single();

          await supabase
            .from("no_show_logs")
            .update({
              status: "recovered",
              recovered_at: now.toISOString(),
              recovery_assignment_id: newAssignment?.id,
              notes: `Recovered with employee ${replacement.id}`,
              updated_at: now.toISOString(),
            })
            .eq("id", existingNoShow.id);

          recovered.push(order.id);
        }
      }
    }

    return NextResponse.json(
      {
        date: today,
        detected: detected.length,
        penalized: penalized.length,
        recovered: recovered.length,
        errors: errors.length,
        detectedOrderIds: detected,
        penalizedOrderIds: penalized,
        recoveredOrderIds: recovered,
        errorDetails: errors,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("No-show cron error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

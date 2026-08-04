import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { detectChurnSignal } from "@/lib/churn-detection";
import { safeErrorResponse } from "@/lib/api-errors";
import { requireCronAuth } from "@/lib/cron-auth"; // Fix R5: constant-time cron auth

/**
 * POST /api/cron/churn-detection
 *
 * v8.3 E10 (D.10.9) — detectChurnSignal() (función pura, ya testeada) nunca
 * se ejecutaba: ni cron ni ruta la llamaban. Este cron corre diario y evalúa
 * las 2 de las 4 reglas del spec que son objetivamente calculables desde
 * datos existentes (días sin servicio + patrón recurrente/esporádico). Las
 * otras 2 ("mención de competidor", "score de equipo cayó >70→<40") se
 * registran manualmente vía POST /api/admin/churn-signals — ver comentario
 * en migración 145.
 *
 * Un cliente = 'recurring' si tiene un service_contracts activo, si no
 * 'sporadic'. daysSinceLastService = hoy - fecha del último order
 * 'completed'. No se generan señales duplicadas mientras haya una 'pending'
 * abierta para el mismo cliente (índice único parcial, migración 145).
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}.
 */
export async function GET(request: NextRequest) {
  // Fix R5: Use constant-time requireCronAuth instead of inline comparison
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Último servicio completado por cliente.
    const { data: completedOrders, error: ordersError } = await supabase
      .from("orders")
      .select("user_id, service_date")
      .eq("status", "completed")
      .order("service_date", { ascending: false });

    if (ordersError) {
      console.error("ordersError:", ordersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const lastServiceByClient = new Map<string, string>();
    for (const o of completedOrders || []) {
      if (!lastServiceByClient.has(o.user_id)) {
        lastServiceByClient.set(o.user_id, o.service_date);
      }
    }

    const { data: activeContracts, error: contractsError } = await supabase
      .from("service_contracts")
      .select("user_id")
      .eq("status", "active");

    if (contractsError) {
      console.error("contractsError:", contractsError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    const recurringClientIds = new Set((activeContracts || []).map((c) => c.user_id));

    const todayMs = Date.now();
    let created = 0;
    let skippedExistingPending = 0;

    for (const [clientUserId, lastServiceDateStr] of lastServiceByClient.entries()) {
      const lastServiceMs = new Date(`${lastServiceDateStr}T00:00:00Z`).getTime();
      const daysSinceLastService = Math.floor((todayMs - lastServiceMs) / (1000 * 60 * 60 * 24));
      const pattern = recurringClientIds.has(clientUserId) ? "recurring" : "sporadic";

      const signal = detectChurnSignal({
        pattern,
        daysSinceLastService,
        cancelledWithCompetitorMention: false,
      });

      if (signal.action === "none") continue;

      const { error: insertError } = await supabase.from("churn_signals").insert({
        client_user_id: clientUserId,
        action: signal.action,
        reason: signal.reason,
        pattern,
        days_since_last_service: daysSinceLastService,
        source: "cron",
      });

      if (insertError) {
        // Índice único parcial (1 pending por cliente) -- ya hay una señal
        // abierta para este cliente, no es un error real.
        if (insertError.code === "23505") {
          skippedExistingPending += 1;
          continue;
        }
        console.error("insertError:", insertError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      created += 1;
    }

    return NextResponse.json(
      { evaluated: lastServiceByClient.size, created, skippedExistingPending },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

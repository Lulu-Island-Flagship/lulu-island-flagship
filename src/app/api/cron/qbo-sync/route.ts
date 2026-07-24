import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { pushSalesReceipt } from "@/lib/qbo-adapter";
import { decideQboSyncAction, evaluateQboDivergence, type QboSyncRetryState } from "@/lib/qbo-sync";
import { getVancouverTodayString } from "@/lib/date-utils";

/**
 * POST /api/cron/qbo-sync
 *
 * Job programado a las 2:00 AM hora Vancouver. Prepara Y EXPORTA (cuando
 * haya proveedor) las órdenes pagadas de las últimas 24h.
 *
 * v8.3 E2.6 — este cron tenía un TODO explícito: nunca llamaba a la API real
 * de QBO, no tenía reintentos con backoff ni alerta de divergencia. No hay
 * credenciales OAuth2 de QBO en este entorno (adaptador honesto
 * `not_configured`, src/lib/qbo-adapter.ts) -- lo que se cierra aquí es la
 * lógica de reintento/backoff (5 intentos, src/lib/qbo-sync.ts) y la
 * detección de divergencia Shadow Ledger vs QBO >0.1%, que el spec exige
 * independientemente de si el proveedor real ya está conectado. Cuando se
 * conecte el proveedor real, este cron no cambia: solo pushSalesReceipt()
 * empieza a devolver "success"/"failed" de verdad en vez de "not_configured".
 *
 * Seguridad: requiere header Authorization: Bearer ${CRON_SECRET}
 */

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

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const nowIso = new Date().toISOString();

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const todayStrForExport = getVancouverTodayString();

    // v8.3 E2 (migración 023) — fila padre `qbo_exports` para conciliación:
    // el código ya escribía en qbo_export_lines con export_id siempre NULL
    // (038 lo hizo nullable justamente porque nunca se creaba el padre) —
    // tickets_disputas/alertas de divergencia usaban qbo_export_lines
    // directo, pero el spec E2 pide el registro agregado (status, totales)
    // para conciliación real contra QBO. Una fila por día (upsert por
    // export_date, igual patrón que qbo_divergence_alerts).
    const { data: existingExport } = await supabase
      .from("qbo_exports")
      .select("id, total_transactions, total_gross, total_fees, total_net")
      .eq("export_date", todayStrForExport)
      .maybeSingle();

    let exportId: string | null = existingExport?.id ?? null;
    if (!exportId) {
      const { data: createdExport, error: createExportError } = await supabase
        .from("qbo_exports")
        .insert({ export_date: todayStrForExport, status: "pending" })
        .select("id")
        .single();
      if (createExportError) {
        console.error("QBO exports parent insert error:", createExportError);
      } else {
        exportId = createdExport?.id ?? null;
      }
    }

    // Órdenes nuevas (nunca intentadas) + reintentos pendientes cuyo backoff
    // ya se cumplió o que nunca se les asignó qbo_sync_attempts.
    // Fix (auditoría operativa/contable 2026-07-21, F2 -- confirmado real):
    // esta consulta pedía gst/pst/subtotal directo de `orders`, pero esas
    // columnas NUNCA existieron ahí (viven en `quotes`, ver
    // 001_modulo1_base_schema.sql) -- PostgREST rechaza un select con una
    // columna inexistente con un error 400, así que ESTA CONSULTA FALLABA
    // SIEMPRE, y el cron completo devolvía 500 en cada corrida sin
    // sincronizar ni una sola orden a QBO. Se corrige con el join real
    // orders.quote_id -> quotes.gst/pst (mismo patrón que
    // stripe/confirm/route.ts y otras rutas de esta sesión). `subtotal` se
    // quita del select -- no se usa en ningún punto de este archivo.
    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, user_id, total_paid_cents, card_amount_charged_cents, qbo_sync_attempts, qbo_last_attempt_at, quotes:quote_id ( gst, pst )"
      )
      .in("qbo_export_status", ["pending", "failed"])
      .gte("capture_captured_at", since)
      .order("capture_captured_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("QBO sync fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const results: { orderId: string; status: string; error?: string }[] = [];

    for (const order of orders || []) {
      const retryState: QboSyncRetryState = {
        attempts: order.qbo_sync_attempts || 0,
        lastAttemptAtIso: order.qbo_last_attempt_at,
      };
      const decision = decideQboSyncAction(retryState, nowIso);

      if (decision.action === "wait_backoff") {
        results.push({ orderId: order.id, status: "waiting_backoff" });
        continue;
      }

      if (decision.action === "give_up_pending_sync") {
        await supabase
          .from("orders")
          .update({ qbo_export_status: "pending_sync", updated_at: nowIso })
          .eq("id", order.id);
        results.push({ orderId: order.id, status: "pending_sync", error: "Max retries exhausted" });
        continue;
      }

      // action === "attempt_now"
      // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents ya está en
      // centavos -- sin *100. gst/pst viven en `quotes` (fuera de alcance
      // de RAÍZ-3, siguen en dólares con decimales), se leen vía el join
      // de arriba (fix F2) y se escalan x100.
      const quoteForTax = (order.quotes as unknown as { gst: number; pst: number }[] | null)?.[0];
      const gross = Math.round(order.total_paid_cents || 0);
      const gst = Math.round((quoteForTax?.gst || 0) * 100);
      const pst = Math.round((quoteForTax?.pst || 0) * 100);
      const fee = Math.round(gross * 0.029 + 30);
      const net = gross - fee;

      const pushResult = await pushSalesReceipt({
        orderId: order.id,
        grossAmountCents: gross,
        gstAmountCents: gst,
        pstAmountCents: pst,
        description: `Sales receipt order ${order.id}`,
      });

      // v8.3 E2 (migración 187) — upsert por (order_id, transaction_type) en
      // vez de insert puro: mientras el adaptador QBO real no esté
      // conectado (pushResult.status === "not_configured"),
      // orders.qbo_export_status nunca llega a "exported", así que esta
      // misma orden vuelve a calificar en la siguiente corrida del cron
      // (mientras siga dentro de la ventana de 24h). Un insert puro
      // duplicaba la línea "sales_receipt" en cada corrida; el upsert la
      // actualiza in-place y mantiene el índice único
      // qbo_export_lines_order_type_unique como garantía real de
      // idempotencia (no solo aplicativa).
      const { error: lineError } = await supabase.from("qbo_export_lines").upsert(
        {
          order_id: order.id,
          export_id: exportId,
          payment_intent_id: pushResult.qboTransactionId,
          transaction_type: "sales_receipt",
          transaction_date: nowIso,
          gross_amount: gross,
          fee_amount: fee,
          net_amount: net,
          gst_amount: gst,
          pst_amount: pst,
          description: `Sales receipt order ${order.id}`,
        },
        { onConflict: "order_id,transaction_type" }
      );

      if (lineError) {
        console.error("QBO export line insert error:", lineError);
        results.push({ orderId: order.id, status: "failed", error: lineError.message });
        await supabase
          .from("orders")
          .update({
            qbo_export_status: "failed",
            qbo_sync_attempts: retryState.attempts + 1,
            qbo_last_attempt_at: nowIso,
            qbo_last_error: lineError.message.slice(0, 500),
            updated_at: nowIso,
          })
          .eq("id", order.id);
        continue;
      }

      // pushResult.status es "not_configured" mientras no exista el
      // adaptador real -- se registra igual como intento fallido (con el
      // motivo explícito) para que el conteo de reintentos/backoff opere
      // igual que ante un fallo real de red. La línea de exportación queda
      // como registro preparado (igual que el comportamiento histórico
      // pre-E2.6), lista para cuando el proveedor real esté conectado.
      if (pushResult.status !== "success") {
        results.push({ orderId: order.id, status: "prepared_not_pushed", error: pushResult.status });
        await supabase
          .from("orders")
          .update({
            qbo_sync_attempts: retryState.attempts + 1,
            qbo_last_attempt_at: nowIso,
            qbo_last_error: `QBO provider ${pushResult.status}`,
            updated_at: nowIso,
          })
          .eq("id", order.id);
        continue;
      }

      await supabase
        .from("orders")
        .update({
          qbo_export_status: "exported",
          qbo_sync_attempts: retryState.attempts + 1,
          qbo_last_attempt_at: nowIso,
          qbo_last_error: null,
          updated_at: nowIso,
        })
        .eq("id", order.id);

      results.push({ orderId: order.id, status: "exported" });
    }

    // v8.3 E2 (migración 023) — actualizar totales agregados de la fila
    // padre con lo realmente insertado en qbo_export_lines para este
    // export_id (fuente de verdad = las líneas, no el conteo de `results`,
    // para no divergir si una línea de una corrida previa del mismo día ya
    // existía). status: 'exported' si se exportó >=1 línea con éxito real
    // (pushResult "success"), 'failed' si hubo intentos pero ninguno cerró,
    // 'pending' si no había nada que exportar todavía.
    if (exportId) {
      const { data: linesForExport } = await supabase
        .from("qbo_export_lines")
        .select("gross_amount, fee_amount, net_amount")
        .eq("export_id", exportId);

      const totals = (linesForExport || []).reduce(
        (acc, l) => ({
          count: acc.count + 1,
          gross: acc.gross + (l.gross_amount || 0),
          fees: acc.fees + (l.fee_amount || 0),
          net: acc.net + (l.net_amount || 0),
        }),
        { count: 0, gross: 0, fees: 0, net: 0 }
      );

      const exportedCount = results.filter((r) => r.status === "exported").length;
      const attemptedCount = results.filter((r) => r.status !== "waiting_backoff").length;
      const exportStatus =
        totals.count === 0
          ? "pending"
          : exportedCount > 0
            ? "exported"
            : attemptedCount > 0
              ? "failed"
              : "pending";

      await supabase
        .from("qbo_exports")
        .update({
          status: exportStatus,
          total_transactions: totals.count,
          total_gross: totals.gross,
          total_fees: totals.fees,
          total_net: totals.net,
          updated_at: nowIso,
        })
        .eq("id", exportId);
    }

    // v8.3 E2.6 — divergencia Shadow Ledger vs QBO del día (Vancouver).
    // Compara lo capturado según Shadow Ledger (fuente de verdad operativa)
    // contra lo efectivamente exportado a QBO en las últimas 24h. UNIQUE
    // (alert_date) en qbo_divergence_alerts evita duplicar si el cron corre
    // más de una vez el mismo día.
    const todayStr = getVancouverTodayString();
    const { data: shadowEntries } = await supabase
      .from("shadow_ledger_entries")
      .select("amount_cents")
      .eq("event_type", "balance_captured")
      .gte("occurred_at", since);
    const shadowTotalCents = (shadowEntries || []).reduce(
      (sum: number, e: { amount_cents: number }) => sum + (e.amount_cents || 0),
      0
    );

    // B-P3-2 fix (auditoría 2026-07-21): esta suma no filtraba por
    // transaction_type. qbo_export_lines guarda una línea 'capture' por
    // orden (escrita directo por batch-capture/batch-capture-retry al
    // momento del cobro) Y, más tarde en esta misma corrida del cron, una
    // línea 'sales_receipt' para la MISMA orden (arriba, línea ~145) --
    // sumando ambas se duplicaba el importe de cada orden capturada, así
    // que qboTotalCents casi siempre salía ~2x shadowTotalCents y la
    // alerta de divergencia se disparaba todos los días sin excepción,
    // quedando muerta por ruido. Se filtra a 'capture', que es el
    // contraparte directo de shadow_ledger_entries.event_type =
    // 'balance_captured' consultado arriba.
    const { data: qboLines } = await supabase
      .from("qbo_export_lines")
      .select("gross_amount")
      .eq("transaction_type", "capture")
      .gte("transaction_date", since);
    const qboTotalCents = (qboLines || []).reduce(
      (sum: number, l: { gross_amount: number }) => sum + (l.gross_amount || 0),
      0
    );

    const divergence = evaluateQboDivergence(shadowTotalCents, qboTotalCents);
    if (divergence.exceedsThreshold) {
      await supabase.from("qbo_divergence_alerts").upsert(
        {
          alert_date: todayStr,
          shadow_total_cents: shadowTotalCents,
          qbo_total_cents: qboTotalCents,
          divergence_ratio: divergence.divergenceRatio,
        },
        { onConflict: "alert_date", ignoreDuplicates: true }
      );
    }

    return NextResponse.json(
      {
        processed: results.length,
        results,
        divergence,
        note: "QBO OAuth2 integration required to push Sales Receipts for real (adapter returns not_configured until then).",
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("QBO sync cron error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

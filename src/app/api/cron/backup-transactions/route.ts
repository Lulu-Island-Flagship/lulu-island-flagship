import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeBackupDueStatus } from "@/lib/backup-jobs";
import { storeBackupCsv } from "@/lib/backup-storage";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/backup-transactions — v8.3 E9.10, "transacciones diario".
 * Vuelca shadow_ledger_entries de las últimas 24h a un CSV+hash en
 * Storage. Fuente de verdad operativa (081_e2_shadow_ledger.sql), no QBO.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (authHeader?.replace("Bearer ", "") !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Supabase service credentials not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { data: lastRun } = await supabase
      .from("backup_job_runs")
      .select("created_at")
      .eq("job_type", "transactions_daily")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const today = new Date();
    const due = computeBackupDueStatus(
      "transactions_daily",
      lastRun?.created_at ?? null,
      today.toISOString()
    );
    if (!due.due) {
      return NextResponse.json({ skipped: true, reason: "not_due_yet" }, { status: 200 });
    }

    const periodEnd = today;
    const periodStart = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    const { data: entries, error } = await supabase
      .from("shadow_ledger_entries")
      .select(
        "id, event_type, order_id, user_id, amount_cents, currency, payment_processor, external_reference, occurred_at, recorded_at"
      )
      .gte("occurred_at", periodStart.toISOString())
      .lt("occurred_at", periodEnd.toISOString())
      .order("occurred_at", { ascending: true });

    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

    const headers = [
      "id",
      "event_type",
      "order_id",
      "user_id",
      "amount_cents",
      "currency",
      "payment_processor",
      "external_reference",
      "occurred_at",
      "recorded_at",
    ];
    const rows = (entries || []).map((e) => [
      e.id,
      e.event_type,
      e.order_id,
      e.user_id,
      e.amount_cents,
      e.currency,
      e.payment_processor,
      e.external_reference,
      e.occurred_at,
      e.recorded_at,
    ]);

    const result = await storeBackupCsv(
      supabase,
      "transactions_daily",
      headers,
      rows,
      periodStart.toISOString(),
      periodEnd.toISOString()
    );

    return NextResponse.json({ rowCount: rows.length, ...result }, { status: result.success ? 200 : 500 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

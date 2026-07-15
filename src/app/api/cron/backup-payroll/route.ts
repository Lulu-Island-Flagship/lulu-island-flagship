import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeBackupDueStatus } from "@/lib/backup-jobs";
import { storeBackupCsv } from "@/lib/backup-storage";

/**
 * POST /api/cron/backup-payroll — v8.3 E9.10, "nómina por ciclo".
 *
 * El ciclo real es quincenal pero su fecha exacta de cierre varía; en vez
 * de reimplementar el cálculo de límites de ciclo (ya vive en
 * payroll-export), este backup toma una ventana simple: los
 * payroll_entries con created_at en los últimos 14 días -- aproximación
 * razonable de "un ciclo", sin depender de que este cron corra exactamente
 * el mismo día que se cierra un ciclo real.
 */
export async function POST(request: NextRequest) {
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
      .eq("job_type", "payroll_per_cycle")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const today = new Date();
    const due = computeBackupDueStatus("payroll_per_cycle", lastRun?.created_at ?? null, today.toISOString());
    if (!due.due) {
      return NextResponse.json({ skipped: true, reason: "not_due_yet" }, { status: 200 });
    }

    const periodEnd = today;
    const periodStart = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);

    const { data: entries, error } = await supabase
      .from("payroll_entries")
      .select("id, employee_id, order_id, gross_amount, status, approved_at, paid_at, payment_reference, created_at")
      .gte("created_at", periodStart.toISOString())
      .lt("created_at", periodEnd.toISOString())
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const headers = [
      "id",
      "employee_id",
      "order_id",
      "gross_amount",
      "status",
      "approved_at",
      "paid_at",
      "payment_reference",
      "created_at",
    ];
    const rows = (entries || []).map((e) => [
      e.id,
      e.employee_id,
      e.order_id,
      e.gross_amount,
      e.status,
      e.approved_at,
      e.paid_at,
      e.payment_reference,
      e.created_at,
    ]);

    const result = await storeBackupCsv(
      supabase,
      "payroll_per_cycle",
      headers,
      rows,
      periodStart.toISOString(),
      periodEnd.toISOString()
    );

    return NextResponse.json({ rowCount: rows.length, ...result }, { status: result.success ? 200 : 500 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

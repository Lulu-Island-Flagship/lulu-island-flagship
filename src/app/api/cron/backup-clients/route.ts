import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCronAuth } from "@/lib/cron-auth"; // Fix R5: Use constant-time requireCronAuth instead of inline comparison
import { computeBackupDueStatus } from "@/lib/backup-jobs";
import { storeBackupCsv } from "@/lib/backup-storage";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/backup-clients — v8.3 E9.10, "clientes semanal".
 * Vuelca client_profiles a un CSV+hash en Storage. No incluye fotos ni
 * tokens de pago -- solo el perfil, para que la restauración de clientes
 * sea posible sin depender de la copia completa de Postgres.
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
    const { data: lastRun } = await supabase
      .from("backup_job_runs")
      .select("created_at")
      .eq("job_type", "clients_weekly")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const today = new Date();
    const due = computeBackupDueStatus("clients_weekly", lastRun?.created_at ?? null, today.toISOString());
    if (!due.due) {
      return NextResponse.json({ skipped: true, reason: "not_due_yet" }, { status: 200 });
    }

    const { data: clients, error } = await supabase
      .from("client_profiles")
      .select(
        "user_id, score, services_count, disputes_count, no_show_count, account_type, company_name, preferred_languages, marketing_opt_in, consent_photo_marketing, referral_code, created_at"
      )
      .order("user_id", { ascending: true });

    if (error) { console.error("Supabase query error:", error); return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 }); }

    const headers = [
      "user_id",
      "score",
      "services_count",
      "disputes_count",
      "no_show_count",
      "account_type",
      "company_name",
      "preferred_languages",
      "marketing_opt_in",
      "consent_photo_marketing",
      "referral_code",
      "created_at",
    ];
    const rows = (clients || []).map((c) => [
      c.user_id,
      c.score,
      c.services_count,
      c.disputes_count,
      c.no_show_count,
      c.account_type,
      c.company_name,
      Array.isArray(c.preferred_languages) ? c.preferred_languages.join("|") : c.preferred_languages,
      c.marketing_opt_in,
      c.consent_photo_marketing,
      c.referral_code,
      c.created_at,
    ]);

    const periodEnd = today;
    const periodStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = await storeBackupCsv(
      supabase,
      "clients_weekly",
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

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeBackupDueStatus } from "@/lib/backup-jobs";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/backup-pg-dump-reminder — v8.3 E9.10, "pg_dump mensual
 * restaurable <48h en otro proveedor."
 *
 * Un `pg_dump` real requiere acceso directo psql al host de Postgres, que
 * no existe desde una función serverless de Next.js/Vercel. En vez de
 * fingir un dump que no ocurrió, este cron SOLO deja un recordatorio
 * accionable (destination='reminder_only', status='not_configured')
 * cuando toca correrlo -- el dueño (o un job externo con acceso directo,
 * ej. GitHub Actions con conexión a la base) debe ejecutar el pg_dump real
 * y luego este mismo registro puede marcarse manualmente. La disciplina
 * de PROBAR que un dump restaura correctamente ya vive en E11.4/DR Drills
 * (src/lib/dr-drill.ts, tabla disaster_recovery_drills) -- este cron no la
 * duplica, solo asegura que el recordatorio de "tocaba correr uno este
 * mes" no se pierda.
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
      .eq("job_type", "pg_dump_monthly")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const today = new Date();
    const due = computeBackupDueStatus("pg_dump_monthly", lastRun?.created_at ?? null, today.toISOString());
    if (!due.due) {
      return NextResponse.json({ skipped: true, reason: "not_due_yet" }, { status: 200 });
    }

    const periodEnd = today;
    const periodStart = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    await supabase.from("backup_job_runs").insert({
      job_type: "pg_dump_monthly",
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      destination: "reminder_only",
      status: "not_configured",
      error_message:
        "pg_dump real requiere acceso directo a Postgres (no disponible desde esta función serverless). Recordatorio generado -- ejecutar manualmente y registrar en DR Drills (E11.4).",
    });

    return NextResponse.json(
      { reminded: true, note: "pg_dump must be run manually or via a job with direct DB access." },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

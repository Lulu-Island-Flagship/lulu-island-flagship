import { NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createClient } from "@supabase/supabase-js";
import { computeBackupDueStatus } from "@/lib/backup-jobs";
import { storeBackupCsv } from "@/lib/backup-storage";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/cron/backup-photos-manifest — v8.3 E9.10, "fotos mensual".
 *
 * Honestidad de alcance: copiar binarios de fotos (potencialmente miles,
 * varios GB) desde una función serverless con timeout corto no es
 * confiable. Lo que SÍ se construye aquí es un MANIFIESTO completo y
 * verificable de qué fotos existen hoy (checklist + evidencia de
 * garantía) con su URL y hash de referencia -- el manifiesto en sí se
 * guarda con CSV+hash igual que los demás backups, y sirve como la lista
 * de qué debe replicarse cuando se configure un job de copia real
 * (rclone/similar) contra B2/Glacier. Nunca se simula la copia binaria.
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
    const { data: lastRun } = await supabase
      .from("backup_job_runs")
      .select("created_at")
      .eq("job_type", "photos_monthly")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const today = new Date();
    const due = computeBackupDueStatus("photos_monthly", lastRun?.created_at ?? null, today.toISOString());
    if (!due.due) {
      return NextResponse.json({ skipped: true, reason: "not_due_yet" }, { status: 200 });
    }

    const { data: checklistPhotos } = await supabase
      .from("service_checklist_items")
      .select("id, order_id, photo_url, completed_at")
      .not("photo_url", "is", null);

    const { data: evidencePhotos } = await supabase
      .from("warranty_photo_evidence")
      .select("id, warranty_claim_id, photo_url, created_at")
      .not("photo_url", "is", null);

    const headers = ["source_table", "source_row_id", "reference_id", "photo_url", "reference_date"];
    const rows: (string | number | null)[][] = [
      ...(checklistPhotos || []).map((p) => [
        "service_checklist_items",
        p.id,
        p.order_id,
        p.photo_url,
        p.completed_at,
      ]),
      ...(evidencePhotos || []).map((p) => [
        "warranty_photo_evidence",
        p.id,
        p.warranty_claim_id,
        p.photo_url,
        p.created_at,
      ]),
    ];

    const periodEnd = today;
    const periodStart = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = await storeBackupCsv(
      supabase,
      "photos_monthly",
      headers,
      rows,
      periodStart.toISOString(),
      periodEnd.toISOString()
    );

    return NextResponse.json(
      {
        manifestRowCount: rows.length,
        note: "This is a manifest of photo URLs, not a binary copy — see route comment for scope.",
        ...result,
      },
      { status: result.success ? 200 : 500 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

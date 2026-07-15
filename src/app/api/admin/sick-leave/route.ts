import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

/**
 * GET /api/admin/sick-leave — v8.3 (BC ESA Parte 5.1). Vista de todas las
 * ausencias reportadas, con acceso a la nota médica adjunta (signed URL,
 * bucket privado) cuando exista. Recurso "compliance" (información de
 * salud del empleado).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getUTCFullYear()), 10);

  const { data: requests, error } = await auth.supabase
    .from("sick_leave_requests")
    .select(
      "id, employee_id, absence_date, reason_type, reason_text, document_path, pay_type, eligibility_reason, paid_amount_cents, created_at"
    )
    .gte("absence_date", `${year}-01-01`)
    .lte("absence_date", `${year}-12-31`)
    .order("absence_date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const employeeIds = Array.from(new Set((requests || []).map((r) => r.employee_id)));
  const nameById = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: employees } = await auth.supabase.from("employees").select("id, name").in("id", employeeIds);
    for (const e of employees || []) nameById.set(e.id, e.name);
  }

  const enriched = await Promise.all(
    (requests || []).map(async (r) => {
      let documentSignedUrl: string | null = null;
      if (r.document_path) {
        const { data: signed } = await auth.supabase!.storage
          .from("sick-notes")
          .createSignedUrl(r.document_path, 3600);
        documentSignedUrl = signed?.signedUrl || null;
      }
      return { ...r, employeeName: nameById.get(r.employee_id) || r.employee_id, documentSignedUrl };
    })
  );

  return NextResponse.json({ requests: enriched }, { status: 200 });
}

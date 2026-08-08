import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { computeCertificationStatus } from "@/lib/certifications";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET/POST /api/admin/certifications — v8.3 E9.4 / E7 / D.9 Doc 3.
 *
 * Certificación química de 3 niveles con vencimiento REAL (antes se
 * afirmaba manualmente en el ascenso de carrera, ver src/lib/career-path.ts
 * comentario "no hay tabla de certificaciones"). El bloqueo de asignación
 * real ocurre en el cron dispatch-scheduler, no aquí -- este endpoint solo
 * gestiona el registro.
 *
 * Recurso "compliance" (mismo nivel que WorkSafeBC/PIPEDA).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: employees, error: employeesError } = await auth.supabase
    .from("employees")
    .select("id, name, role, is_active")
    .order("name", { ascending: true });
  if (employeesError) {
    console.error("admin/certifications error:", employeesError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: certifications, error: certsError } = await auth.supabase
    .from("employee_certifications")
    .select("id, employee_id, level, certificate_type, issued_at, expires_at, revoked_at, revoked_reason")
    .order("expires_at", { ascending: true });
  if (certsError) {
    console.error("admin/certifications error:", certsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const todayISO = new Date().toISOString();
  const byEmployee = new Map<string, typeof certifications>();
  for (const c of certifications || []) {
    const list = byEmployee.get(c.employee_id) || [];
    list.push(c);
    byEmployee.set(c.employee_id, list);
  }

  const rows = (employees || []).map((e) => {
    const certs = (byEmployee.get(e.id) || []).map((c) => ({
      ...c,
      status: computeCertificationStatus(
        { level: c.level, expiresAtISO: c.expires_at, revokedAtISO: c.revoked_at },
        todayISO
      ),
    }));
    const hasAnyValid = certs.some((c) => c.status === "valid" || c.status === "expiring_soon");
    return { employee: e, certifications: certs, assignable: hasAnyValid };
  });

  return NextResponse.json(
    {
      employees: rows,
      blockedCount: rows.filter((r) => r.employee.is_active && !r.assignable).length,
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "compliance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const body = await request.json();
    const { employeeId, level, certificateType, issuedAt, expiresAt, documentUrl } = body as {
      employeeId?: string;
      level?: number;
      certificateType?: string;
      issuedAt?: string;
      expiresAt?: string;
      documentUrl?: string;
    };

    if (!employeeId || typeof employeeId !== "string") {
      return NextResponse.json({ error: "employeeId is required" }, { status: 400 });
    }
    if (![1, 2, 3].includes(level as number)) {
      return NextResponse.json({ error: "level must be 1, 2, or 3" }, { status: 400 });
    }
    if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
      return NextResponse.json({ error: "expiresAt is required" }, { status: 400 });
    }

    const { data: created, error } = await auth.supabase
      .from("employee_certifications")
      .insert({
        employee_id: employeeId,
        level,
        certificate_type: certificateType?.trim() || "chemical_handling",
        issued_at: issuedAt || new Date().toISOString(),
        expires_at: expiresAt,
        document_url: documentUrl?.trim() || null,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/certifications error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ certification: created }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

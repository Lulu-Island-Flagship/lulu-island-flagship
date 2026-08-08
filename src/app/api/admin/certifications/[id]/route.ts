import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

/** PATCH /api/admin/certifications/[id] — revocar una certificación (nunca se borra, se revoca con motivo, mismo espíritu de auditoría que el resto del sistema). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "compliance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const { id } = await params;

  try {
    const body = await request.json();
    const { reason } = body as { reason?: string };
    if (!reason || reason.trim().length === 0) {
      return NextResponse.json({ error: "reason is required to revoke a certification" }, { status: 400 });
    }

    const { data: updated, error } = await auth.supabase
      .from("employee_certifications")
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason.trim() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("admin/certifications/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ certification: updated }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

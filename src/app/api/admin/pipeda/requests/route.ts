import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeRequestDueAt, isRequestOverdue } from "@/lib/pipeda";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET/POST /api/admin/pipeda/requests — v8.3 E9.9. Los tres derechos del
 * sujeto de datos bajo PIPEDA: acceso, corrección, eliminación.
 *
 * Recurso "compliance" — solo owner_admin (admin-rbac.ts), misma
 * sensibilidad legal que finance/payroll.
 *
 * IMPORTANTE (alcance real, no inventado): esto es la herramienta de
 * SEGUIMIENTO de la solicitud (deadline, estado, quién la procesó) para
 * que el admin cumpla el plazo. NO genera automáticamente el export de
 * datos del cliente (eso requeriría un job de agregación cross-tabla que
 * no existe hoy) -- `exportReference` queda como campo libre para que el
 * admin registre dónde dejó el archivo una vez lo arma manualmente. Se
 * documenta como límite de alcance, no se simula.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: requests, error } = await auth.supabase
    .from("data_subject_requests")
    .select(
      "id, client_user_id, request_type, status, requested_at, due_at, completed_at, requested_by_admin, processed_by_admin, correction_details, denial_reason, export_reference, purge_eligible_at, purged_at, deletion_errors, created_at"
    )
    .is("deleted_at", null)
    .order("requested_at", { ascending: false });

  if (error) {
    console.error("admin/pipeda/requests error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const now = new Date();
  const enriched = (requests || []).map((r) => ({
    ...r,
    overdue: isRequestOverdue(new Date(r.due_at), now, r.status),
  }));

  return NextResponse.json(
    {
      requests: enriched,
      overdueCount: enriched.filter((r) => r.overdue).length,
    },
    { status: 200 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { clientUserId, requestType, correctionDetails } = body as {
      clientUserId?: string;
      requestType?: string;
      correctionDetails?: string;
    };

    if (!clientUserId || typeof clientUserId !== "string") {
      return NextResponse.json({ error: "clientUserId is required" }, { status: 400 });
    }
    if (!["access", "correction", "deletion"].includes(requestType || "")) {
      return NextResponse.json({ error: "requestType must be access, correction, or deletion" }, { status: 400 });
    }
    if (requestType === "correction" && (!correctionDetails || correctionDetails.trim().length === 0)) {
      return NextResponse.json({ error: "correctionDetails is required for correction requests" }, { status: 400 });
    }

    const requestedAt = new Date();
    const dueAt = computeRequestDueAt(requestedAt);

    const { data: created, error } = await auth.supabase
      .from("data_subject_requests")
      .insert({
        client_user_id: clientUserId,
        request_type: requestType,
        status: "pending",
        requested_at: requestedAt.toISOString(),
        due_at: dueAt.toISOString(),
        requested_by_admin: auth.user.id,
        correction_details: requestType === "correction" ? (correctionDetails?.trim() ?? null) : null,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/pipeda/requests error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

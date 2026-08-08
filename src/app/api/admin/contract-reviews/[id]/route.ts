import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * PATCH /api/admin/contract-reviews/[id] — v8.3 E9.8.
 *
 * action: 'approve' | 'dismiss' | 'sign'
 *
 * - approve: el admin confirma que los términos propuestos (o unos
 *   editados) son correctos tras revisar el diff legal. No crea versión
 *   todavía -- solo desbloquea el paso de firma.
 * - dismiss: no aplica ningún cambio este ciclo (ej. los cambios legales
 *   detectados no afectan a este contrato). Requiere motivo.
 * - sign: registra la "firma digital" -- clickwrap (nombre escrito + IP +
 *   timestamp, mismo patrón que quotes.consent_tc/consent_ip). HONESTO:
 *   esto NO es una integración real con Documenso/DocuSign (sin
 *   credenciales en este entorno) y hoy la captura la hace el admin en
 *   nombre del cliente durante la llamada/reunión de renovación -- no hay
 *   todavía un flujo de auto-firma del cliente en /cuenta. Al firmar,
 *   crea la nueva contract_versions y marca la anterior 'superseded'.
 */
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
    const { action } = body as { action?: string };

    const { data: review, error: reviewError } = await auth.supabase
      .from("contract_reviews")
      .select("id, contract_id, status, proposed_terms")
      .eq("id", id)
      .maybeSingle();
    if (reviewError || !review) {
      return NextResponse.json({ error: reviewError?.message || "Review not found" }, { status: 404 });
    }

    if (action === "dismiss") {
      const { reason } = body as { reason?: string };
      if (!reason || reason.trim().length === 0) {
        return NextResponse.json({ error: "reason is required to dismiss a review" }, { status: 400 });
      }
      const { data: updated, error } = await auth.supabase
        .from("contract_reviews")
        .update({
          status: "dismissed",
          dismissal_reason: reason.trim(),
          reviewed_by: auth.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        console.error("admin/contract-reviews/[id] error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      return NextResponse.json({ review: updated }, { status: 200 });
    }

    if (action === "approve") {
      if (review.status !== "pending") {
        return NextResponse.json({ error: "Only a pending review can be approved" }, { status: 409 });
      }
      const { proposedTerms } = body as { proposedTerms?: unknown };
      const { data: updated, error } = await auth.supabase
        .from("contract_reviews")
        .update({
          status: "approved",
          proposed_terms: proposedTerms || review.proposed_terms,
          reviewed_by: auth.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) {
        console.error("admin/contract-reviews/[id] error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      return NextResponse.json({ review: updated }, { status: 200 });
    }

    if (action === "sign") {
      if (review.status !== "approved") {
        return NextResponse.json({ error: "Only an approved review can be signed" }, { status: 409 });
      }
      const { signedByName } = body as { signedByName?: string };
      if (!signedByName || signedByName.trim().length === 0) {
        return NextResponse.json({ error: "signedByName is required" }, { status: 400 });
      }

      const forwardedFor = request.headers.get("x-forwarded-for");
      const signedIp = forwardedFor?.split(",")[0]?.trim() || null;

      // Fix (auditoría de integridad de datos 2026-08-02): supersede de la
      // versión anterior + insert de la nueva contract_versions + update de
      // service_contracts + update de contract_reviews eran 4 escrituras
      // REST sueltas -- un fallo a mitad de camino dejaba un documento legal
      // (contrato firmado) en un estado inconsistente. Ahora es una sola
      // llamada RPC atómica (migración 325): o los cuatro pasos committean
      // juntos, o ninguno lo hace.
      const { data: rpcResult, error: rpcError } = await auth.supabase.rpc("sign_contract_review_atomic", {
        p_review_id: id,
        p_admin_id: auth.user.id,
        p_signed_by_name: signedByName.trim(),
        p_signed_ip: signedIp,
      });

      if (rpcError) {
        console.error("admin/contract-reviews/[id] error:", rpcError);
        if (rpcError.message?.includes("REVIEW_NOT_FOUND")) {
          return NextResponse.json({ error: "Review not found" }, { status: 404 });
        }
        if (rpcError.message?.includes("REVIEW_NOT_APPROVED")) {
          return NextResponse.json({ error: "Only an approved review can be signed" }, { status: 409 });
        }
        if (rpcError.message?.includes("SIGNED_BY_NAME_REQUIRED")) {
          return NextResponse.json({ error: "signedByName is required" }, { status: 400 });
        }
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      const result = rpcResult as { review: unknown; version: unknown };
      return NextResponse.json({ review: result.review, version: result.version }, { status: 200 });
    }

    return NextResponse.json({ error: "action must be approve, dismiss, or sign" }, { status: 400 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

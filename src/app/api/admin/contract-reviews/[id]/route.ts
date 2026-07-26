import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

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

      const { data: currentVersion } = await auth.supabase
        .from("contract_versions")
        .select("version_number")
        .eq("contract_id", review.contract_id)
        .eq("status", "active")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersionNumber = (currentVersion?.version_number ?? 0) + 1;

      if (currentVersion) {
        await auth.supabase
          .from("contract_versions")
          .update({ status: "superseded" })
          .eq("contract_id", review.contract_id)
          .eq("status", "active");
      }

      const forwardedFor = request.headers.get("x-forwarded-for");
      const signedIp = forwardedFor?.split(",")[0]?.trim() || null;

      const { data: newVersion, error: versionError } = await auth.supabase
        .from("contract_versions")
        .insert({
          contract_id: review.contract_id,
          review_id: review.id,
          version_number: nextVersionNumber,
          terms_snapshot: review.proposed_terms,
          status: "active",
          signed_by_name: signedByName.trim(),
          signed_ip: signedIp,
          signed_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (versionError) {
        console.error("admin/contract-reviews/[id] error:", versionError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      // Reflejar los términos aprobados en el contrato vigente (mismo
      // patrón que el ajuste IPC ya aplica base_price/total).
      const terms = review.proposed_terms as {
        frequency?: string;
        basePrice?: number;
        total?: number;
        serviceSubtype?: string;
      } | null;
      if (terms) {
        await auth.supabase
          .from("service_contracts")
          .update({
            frequency: terms.frequency,
            base_price: terms.basePrice,
            total: terms.total,
            service_subtype: terms.serviceSubtype,
          })
          .eq("id", review.contract_id);
      }

      const { data: updatedReview, error: reviewUpdateError } = await auth.supabase
        .from("contract_reviews")
        .update({ status: "signed" })
        .eq("id", id)
        .select()
        .single();
      if (reviewUpdateError) {
        console.error("admin/contract-reviews/[id] error:", reviewUpdateError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      return NextResponse.json({ review: updatedReview, version: newVersion }, { status: 200 });
    }

    return NextResponse.json({ error: "action must be approve, dismiss, or sign" }, { status: 400 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
// Fix M13: Use centralized isValidUuid from @/lib/validation
import { isValidUuid } from "@/lib/validation";
import { dispatchCommunication } from "@/lib/send-communication";
import { loadDisputeResolutionContext } from "../../_shared";
import { safeErrorResponse } from "@/lib/api-errors";

type FinalAction = "free_recleaning" | "explain_no_action" | "dismiss";
const VALID_FINAL_ACTIONS: FinalAction[] = ["free_recleaning", "explain_no_action", "dismiss"];

// POST /api/admin/warranty-claims/[id]/resolve — v8.3 E5 (Sesión Q).
//
// Aplica evaluateWarrantyDisputeResolution (src/lib/warranty-dispute-resolution.ts):
//   - Si la decisión es automática (falta de foto de cierre de la zona, o
//     reclamo sin respaldo del cliente), se aplica directamente — 'finalAction'
//     en el body es opcional y se ignora si se envía distinto al sugerido.
//   - Si la decisión requiere revisión humana (evidencia de ambas partes para
//     la misma zona), 'finalAction' es OBLIGATORIO en el body: el patrón es
//     el mismo que exPostReviewOutcome (safety-abort.ts) — la evidencia
//     informa, nunca decide sola en el caso contradictorio.
//
// Reutiliza dispatchCommunication con el evento 'dispute_resolved' ya
// existente (migración 084, mismo evento que usa tickets/[id]/resolve) — no
// se reinventa el envío. Si corresponde re-limpieza, se encola una tarea en
// tickets_disputas (mismo patrón que 080_e2_batch_capture_dispute_exclusion.sql),
// sin inventar una cola paralela.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const finalActionInput: string | undefined = body?.finalAction;
    const resolutionNotesInput: string | undefined = body?.resolutionNotes;

    const ctx = await loadDisputeResolutionContext(auth.supabase, id);
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    }
    const { claim, decision } = ctx;

    if (!["open", "escalated"].includes(claim.status)) {
      return NextResponse.json(
        { error: `Cannot resolve: warranty claim is already ${claim.status}` },
        { status: 409 }
      );
    }

    let appliedFinalAction: FinalAction;
    let autoResolved: boolean;

    if (decision.requiresHumanReview) {
      if (!finalActionInput || !VALID_FINAL_ACTIONS.includes(finalActionInput as FinalAction)) {
        return NextResponse.json(
          {
            error:
              "Este reclamo requiere revisión humana (evidencia fotográfica de ambas partes para la misma zona): " +
              "'finalAction' es obligatorio y debe ser 'free_recleaning', 'explain_no_action' o 'dismiss'.",
            decision,
          },
          { status: 400 }
        );
      }
      appliedFinalAction = finalActionInput as FinalAction;
      autoResolved = false;
    } else {
      // Decisión automática: se aplica el resultado de la función pura tal
      // cual. No permitimos que el body la sobreescriba en contra del
      // invariante (evita que un admin "fuerce" una decisión automática que
      // ya está resuelta por falta/presencia de evidencia).
      appliedFinalAction = decision.suggestedAction === "free_recleaning" ? "free_recleaning" : "explain_no_action";
      autoResolved = true;
    }

    const resolvedStatus =
      appliedFinalAction === "free_recleaning"
        ? "resolved_client"
        : appliedFinalAction === "dismiss"
          ? "dismissed"
          : "resolved_lulu";

    const resolutionNotes = resolutionNotesInput?.trim() || decision.note;

    const { data: resolver } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!resolver?.id) {
      return NextResponse.json({ error: "Resolver not found in employees table" }, { status: 403 });
    }

    const nowIso = new Date().toISOString();

    const { data: updatedClaim, error: updateError } = await auth.supabase
      .from("warranty_claims")
      .update({
        status: resolvedStatus,
        resolution_notes: resolutionNotes,
        resolved_by: resolver.id,
        resolved_at: nowIso,
        auto_resolved: autoResolved,
        decision_outcome: decision.outcome,
        requires_human_review: decision.requiresHumanReview,
        decided_at: nowIso,
        decided_by: resolver.id,
        final_action: appliedFinalAction,
        updated_at: nowIso,
      })
      .eq("id", id)
      .in("status", ["open", "escalated"])
      .select(
        "id, order_id, status, claim_zone, decision_outcome, requires_human_review, final_action, resolution_notes, resolved_at, auto_resolved"
      )
      .single();

    if (updateError) {
      console.error("admin/warranty-claims/[id]/resolve error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!updatedClaim) {
      return NextResponse.json(
        { error: "Cannot resolve: warranty claim status changed concurrently" },
        { status: 409 }
      );
    }

    // Si corresponde re-limpieza, encolar la tarea para el equipo. Sin
    // employee_id específico (SET NULL permitido en tickets_disputas): el
    // reclamo no está atado a un solo empleado, es una tarea del equipo/orden.
    if (appliedFinalAction === "free_recleaning") {
      await auth.supabase.from("tickets_disputas").insert({
        order_id: claim.order_id,
        employee_id: null,
        type: "dispute",
        priority: "high",
        status: "open",
        context: {
          reason: "warranty_recleaning_required",
          warranty_claim_id: id,
          zone: claim.claim_zone,
        },
      });
    }

    // Aviso al cliente — mismo evento y patrón que tickets/[id]/resolve
    // (migración 084, Sesión H). Un fallo de comunicación nunca revierte la
    // resolución ya guardada.
    try {
      const { data: order } = await auth.supabase
        .from("orders")
        .select("id, user_id, service_date")
        .eq("id", claim.order_id)
        .single();

      if (order?.user_id) {
        const { data: profile } = await auth.supabase
          .from("profiles")
          .select("full_name")
          .eq("id", order.user_id)
          .maybeSingle();
        const { data: clientProfile } = await auth.supabase
          .from("client_profiles")
          .select("preferred_languages")
          .eq("user_id", order.user_id)
          .maybeSingle();
        const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
          | "en"
          | "zh"
          | "fr";

        await dispatchCommunication(auth.supabase, {
          eventKey: "dispute_resolved",
          userId: order.user_id,
          orderId: order.id,
          language,
          vars: {
            client_name: profile?.full_name || "cliente",
            service_date: order.service_date,
            resolution_summary: resolutionNotes,
          },
        });
      }
    } catch (commErr) {
      console.error("Error disparando dispute_resolved (warranty-claims):", commErr);
    }

    return NextResponse.json({ claim: updatedClaim, decision }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

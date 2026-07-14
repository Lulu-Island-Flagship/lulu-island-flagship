import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { validateWarrantyClaimInput } from "@/lib/warranty-claim-validation";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options });
      },
    },
  });
}

/**
 * GET /api/client/warranty-claims — reclamos propios del cliente
 * autenticado (todas las órdenes). Nunca expone `decision_outcome` crudo:
 * se traduce a un mensaje legible (el enum interno es vocabulario de admin).
 */
export async function GET() {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: claims, error } = await supabase
    .from("warranty_claims")
    .select(
      "id, order_id, claim_zone, reason, description, status, opened_at, resolved_at, final_action, resolution_notes"
    )
    .eq("user_id", user.id)
    .order("opened_at", { ascending: false });

  if (error) {
    console.error("client/warranty-claims fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ claims: claims || [] }, { status: 200 });
}

/**
 * POST /api/client/warranty-claims — v8.3 E5: presentar un reclamo de
 * garantía. La política RLS de INSERT en warranty_claims ya existía (020)
 * desde el día 1; lo que estaba huérfano era el endpoint que la usara con
 * las validaciones de negocio correctas.
 *
 * Reglas verificadas server-side (no solo confiar en la validación de forma):
 *   1. La orden es del usuario autenticado.
 *   2. La orden está 'completed' (B.2.2: la garantía es contra el cierre real
 *      del servicio, no contra una orden que ni siquiera ocurrió).
 *   3. La zona reclamada existe de verdad en el checklist de ESA orden
 *      (no se puede reclamar sobre una zona que nunca se limpió/registró).
 *   4. No hay ya un reclamo ABIERTO para esa misma orden+zona (respaldado
 *      también por el índice único parcial de la migración 138).
 *
 * severity SIEMPRE nace 'minor' aquí -- nunca a elección del cliente. Solo
 * un admin puede escalar a 'critical' (batch-capture-eligibility.ts exige
 * 'critical' para excluir el cobro del Batch; permitir que el cliente la
 * fije sería reabrir el vector de abuso que ese diseño previene).
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validation = validateWarrantyClaimInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { orderId, claimZone, reason, description, photoUrls } = body as {
      orderId: string;
      claimZone: string;
      reason: string;
      description?: string;
      photoUrls?: string[];
    };

    // 1 + 2: la orden es mía y está completada.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, user_id")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (order.status !== "completed") {
      return NextResponse.json(
        { error: "You can only report an issue for a completed service." },
        { status: 400 }
      );
    }

    // 3: la zona existe de verdad en el checklist de esta orden.
    const { data: checklistRows, error: checklistError } = await supabase
      .from("service_checklist_items")
      .select("sop_checklists(zone)")
      .eq("order_id", orderId);

    if (checklistError) {
      return NextResponse.json({ error: checklistError.message }, { status: 500 });
    }

    const realZones = new Set(
      ((checklistRows as { sop_checklists: { zone: string } | { zone: string }[] | null }[]) || [])
        .map((r) => (Array.isArray(r.sop_checklists) ? r.sop_checklists[0]?.zone : r.sop_checklists?.zone))
        .filter((z): z is string => Boolean(z))
    );

    if (!realZones.has(claimZone)) {
      return NextResponse.json(
        { error: "That zone doesn't match this service's checklist." },
        { status: 400 }
      );
    }

    // 4: la BD también lo protege (índice único parcial, migración 138) --
    // esta comprobación previa solo da un mensaje legible en vez de un 23505.
    const { data: existingOpen } = await supabase
      .from("warranty_claims")
      .select("id")
      .eq("order_id", orderId)
      .eq("claim_zone", claimZone)
      .eq("status", "open")
      .maybeSingle();

    if (existingOpen) {
      return NextResponse.json(
        { error: "There's already an open claim for this zone on this service." },
        { status: 409 }
      );
    }

    const { data: claim, error: insertError } = await supabase
      .from("warranty_claims")
      .insert({
        order_id: orderId,
        user_id: user.id,
        reason: reason.trim(),
        description: description?.trim() || null,
        claim_zone: claimZone,
        status: "open",
        severity: "minor",
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "There's already an open claim for this zone on this service." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    if (photoUrls && photoUrls.length > 0) {
      const { error: evidenceError } = await supabase.from("warranty_photo_evidence").insert(
        photoUrls.map((url) => ({
          warranty_claim_id: claim.id,
          photo_url: url,
          photo_type: "client",
          zone: claimZone,
        }))
      );
      if (evidenceError) {
        console.error("client/warranty-claims evidence insert error:", evidenceError);
        // No se revierte el claim -- ya quedó registrado, y el reclamo sin
        // foto sigue siendo válido (mismo espíritu que B.2.2: la evidencia
        // informa, no es un requisito de admisión).
      }
    }

    return NextResponse.json({ claim }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

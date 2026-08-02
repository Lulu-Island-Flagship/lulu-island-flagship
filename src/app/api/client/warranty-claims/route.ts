import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { validateWarrantyClaimInput, isWarrantyClaimEligible, WARRANTY_CLAIM_WINDOW_DAYS } from "@/lib/warranty-claim-validation";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
      .select("id, status, user_id, service_date")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (orderError) {
      console.error("orderError:", orderError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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

    // v8.3 auditoría 2026-07-21 (E-B4): ventana de reclamación. Sin esto
    // se podía reclamar sobre un servicio de hace años.
    //
    // Fix (auditoría 2026-07-31, hallazgo #5): si `service_date` venía NULL
    // (dato inconsistente -- una orden 'completed' debería siempre tener
    // fecha de servicio, pero el esquema no lo garantiza con NOT NULL), el
    // bloque de arriba se saltaba entero y el reclamo se aceptaba SIN límite
    // de tiempo -- exactamente el hueco que esta ventana de 7 días existe
    // para cerrar. No hay forma segura de determinar si la orden está dentro
    // de la ventana sin una fecha de referencia, así que se rechaza
    // explícitamente en vez de admitir por defecto (mismo principio
    // deny-by-default que la comprobación de reembolso más abajo).
    if (!order.service_date) {
      console.error(
        `client/warranty-claims: orden ${orderId} 'completed' sin service_date -- ` +
          "no se puede determinar la ventana de garantía, se rechaza el reclamo."
      );
      return NextResponse.json(
        { error: "Unable to determine the warranty window for this order. Please contact support." },
        { status: 400 }
      );
    }
    if (!isWarrantyClaimEligible(order.service_date)) {
      return NextResponse.json(
        {
          error: `The warranty claim window (${WARRANTY_CLAIM_WINDOW_DAYS} days after service) has expired for this order.`,
        },
        { status: 400 }
      );
    }

    // v8.3 auditoría 2026-07-21 (E-B4): no se validaba el estado de pago
    // de la orden -- se podía reclamar sobre una orden ya reembolsada.
    // shadow_ledger_entries es el registro de eventos de dinero real del
    // repo (src/lib/shadow-ledger.ts); un 'paypal_refund' o
    // 'warranty_refund' ya emitido para esta orden significa que el
    // dinero ya volvió al cliente. Su RLS (migración 081) solo permite
    // SELECT a is_supervisor() -- la sesión anon del cliente no vería
    // ninguna fila aunque existieran (falso negativo silencioso), así
    // que esta comprobación puntual usa service-role, igual que el resto
    // de lecturas "de confianza" del repo que necesitan ver más de lo
    // que su propia RLS les permitiría.
    // Nota de alcance: shadow_ledger_enabled está apagado por defecto
    // (feature_flags, migración 081) -- mientras esté apagado, esta
    // tabla puede estar vacía incluso para órdenes sí reembolsadas por
    // otras vías (Stripe/PayPal directo). Esta comprobación es la mejor
    // señal disponible en el esquema actual, no una garantía completa.
    // v8.3 fix (auditoría seguridad 2026-07-26): si falta la env var, esta
    // comprobación se saltaba EN SILENCIO (deny-by-default invertido -- el
    // reclamo se aceptaba como si no hubiera reembolso previo). Un control de
    // seguridad que se apaga solo porque falta config no debe fallar abierto:
    // ahora, sin la service key, la operación se rechaza explícitamente (503,
    // "no disponible temporalmente") y se deja un log server-side claro para
    // que el equipo note la misconfiguración -- nunca se expone al cliente
    // que el motivo es una env var faltante.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      console.error(
        "client/warranty-claims: SUPABASE_SERVICE_ROLE_KEY no está configurada -- " +
          "no se puede verificar reembolso previo. Rechazando por seguridad (deny-by-default)."
      );
      return NextResponse.json(
        { error: "Unable to process this request right now. Please try again later." },
        { status: 503 }
      );
    }

    const serviceClient = createClient(getSupabaseUrl(), serviceKey);
    const { data: refundEntries, error: refundError } = await serviceClient
      .from("shadow_ledger_entries")
      .select("id")
      .eq("order_id", orderId)
      .in("event_type", ["paypal_refund", "warranty_refund"])
      .limit(1);

    if (refundError) {
      console.error("client/warranty-claims refund check error:", refundError);
      return NextResponse.json(
        { error: "Unable to process this request right now. Please try again later." },
        { status: 500 }
      );
    }
    if (refundEntries && refundEntries.length > 0) {
      return NextResponse.json(
        { error: "This order has already been refunded and is not eligible for a new warranty claim." },
        { status: 400 }
      );
    }

    // 3: la zona existe de verdad en el checklist de esta orden.
    const { data: checklistRows, error: checklistError } = await supabase
      .from("service_checklist_items")
      .select("sop_checklists(zone)")
      .eq("order_id", orderId);

    if (checklistError) {
      console.error("checklistError:", checklistError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
      console.error("insertError:", insertError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
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
        return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { getServiceRoleClient } from "@/lib/supabase-client";
import { safeErrorResponse } from "@/lib/api-errors";
import {
  validateCoverOfferEligibility,
  type CoverOfferEligibilityInput,
} from "@/lib/turn-marketplace";

// Fix (auditoría externa, hallazgo A12): esta ruta usa `cookies()`
// (request-time) -- sin esto Next intentaba pre-renderizarla en build.
export const dynamic = "force-dynamic";

/**
 * v8.3 F.8 — API de Marketplace de Turnos para empleados.
 *
 * GET  /api/employee/turn-marketplace
 *   Lista las ofertas abiertas en el marketplace. Solo funciona si
 *   el feature flag `turn_marketplace_enabled` está activo.
 *
 * POST /api/employee/turn-marketplace
 *   Un empleado se ofrece a cubrir un turno publicado.
 *   Body: { marketplaceOfferId: string }
 */

// ─── Helpers ────────────────────────────────────────────────────────────

/** Verifica que el feature flag esté activo (usa service role para bypassear RLS). */
async function isMarketplaceEnabled(): Promise<boolean> {
  try {
    const serviceClient = getServiceRoleClient();
    if (!serviceClient) {
      console.error("turn-marketplace: service role client no disponible");
      return false;
    }
    const { data } = await serviceClient
      .from("feature_flags")
      .select("activo")
      .eq("nombre", "turn_marketplace_enabled")
      .is("deleted_at", null)
      .maybeSingle();
    return data?.activo === true;
  } catch (e) {
    console.error("turn-marketplace: error verificando feature flag", e);
    return false;
  }
}

// ─── GET ────────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  try {
    // 1. Feature flag check
    const enabled = await isMarketplaceEnabled();
    if (!enabled) {
      return NextResponse.json(
        { error: "Marketplace de turnos no está disponible en este momento" },
        { status: 503 }
      );
    }

    // 2. Autenticación de empleado
    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } =
      await requireActiveEmployee(supabase, user.id, "id, name");

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // 3. Listar ofertas abiertas (RLS filtra automáticamente)
    const { data: offers, error: offersError } = await supabase
      .from("turn_marketplace_offers")
      .select(`
        id,
        original_employee_id,
        order_id,
        shift_date,
        start_time,
        end_time,
        zone,
        estimated_pay_cents,
        note,
        status,
        created_at_iso,
        expires_at_iso,
        offering_employee_id
      `)
      .in("status", ["open", "offer_submitted"])
      .is("deleted_at", null)
      .order("shift_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (offersError) {
      console.error("turn-marketplace GET error:", offersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // 4. Enriquecer con nombres de empleados (batch, no N+1)
    const employeeIds = new Set<string>();
    for (const o of offers || []) {
      if (o.original_employee_id) employeeIds.add(o.original_employee_id);
      if (o.offering_employee_id) employeeIds.add(o.offering_employee_id);
    }

    const nameMap = new Map<string, string>();
    if (employeeIds.size > 0) {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, name")
        .in("id", Array.from(employeeIds))
        .is("deleted_at", null);
      for (const e of employees || []) {
        nameMap.set(e.id, e.name || "Sin nombre");
      }
    }

    const enriched = (offers || []).map((o) => ({
      ...o,
      original_employee_name: o.original_employee_id
        ? nameMap.get(o.original_employee_id) || null
        : null,
      offering_employee_name: o.offering_employee_id
        ? nameMap.get(o.offering_employee_id) || null
        : null,
    }));

    return NextResponse.json({
      offers: enriched,
      employeeId: employee.id,
    });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

// ─── POST ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 1. Feature flag check
    const enabled = await isMarketplaceEnabled();
    if (!enabled) {
      return NextResponse.json(
        { error: "Marketplace de turnos no está disponible en este momento" },
        { status: 503 }
      );
    }

    // 2. Autenticación de empleado
    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } =
      await requireActiveEmployee(supabase, user.id, "id, name");

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // 3. Parsear body
    let body: { marketplaceOfferId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    if (!body.marketplaceOfferId) {
      return NextResponse.json(
        { error: "Se requiere marketplaceOfferId" },
        { status: 400 }
      );
    }

    // 4. Buscar la oferta
    const { data: offer, error: offerError } = await supabase
      .from("turn_marketplace_offers")
      .select("*")
      .eq("id", body.marketplaceOfferId)
      .eq("status", "open")
      .is("deleted_at", null)
      .single();

    if (offerError || !offer) {
      return NextResponse.json(
        { error: "Oferta no encontrada o ya no está disponible" },
        { status: 404 }
      );
    }

    // 5. Validar elegibilidad
    const nowIso = new Date().toISOString();

    // Contar turnos que este empleado ya cubrió esta semana
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // domingo
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const { count: shiftsCovered, error: countError } = await supabase
      .from("turn_marketplace_offers")
      .select("*", { count: "exact", head: true })
      .eq("offering_employee_id", employee.id)
      .eq("status", "approved")
      .gte("shift_date", weekStartStr)
      .is("deleted_at", null);

    if (countError) {
      console.error("turn-marketplace count error:", countError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const eligibilityInput: CoverOfferEligibilityInput = {
      offeringEmployeeId: employee.id,
      originalEmployeeId: offer.original_employee_id,
      shiftsAlreadyThisWeek: shiftsCovered ?? 0,
      pairingExceptions: [], // RLS impide leer pairing_exceptions como empleado; admin revisa al aprobar
      existingTeammatesOnOrder: [], // ídem
    };

    const validation = validateCoverOfferEligibility(eligibilityInput);

    if (!validation.valid) {
      return NextResponse.json(
        { error: "No se puede cubrir este turno", details: validation.errors },
        { status: 409 }
      );
    }

    // 6. Actualizar la oferta: marcar como offer_submitted
    const { data: updated, error: updateError } = await supabase
      .from("turn_marketplace_offers")
      .update({
        status: "offer_submitted",
        offering_employee_id: employee.id,
        offered_at_iso: nowIso,
      })
      .eq("id", body.marketplaceOfferId)
      .eq("status", "open")
      .is("deleted_at", null)
      .select()
      .single();

    if (updateError) {
      console.error("turn-marketplace POST update error:", updateError);
      return NextResponse.json(
        { error: "Ocurrió un error al registrar la oferta. Puede que otro empleado ya la haya tomado." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      offer: {
        id: updated.id,
        status: updated.status,
        shift_date: updated.shift_date,
        start_time: updated.start_time,
        end_time: updated.end_time,
        zone: updated.zone,
        estimated_pay_cents: updated.estimated_pay_cents,
      },
      message: "Te has ofrecido para cubrir este turno. Un administrador revisará tu oferta.",
    });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

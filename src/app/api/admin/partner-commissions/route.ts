import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { calculatePartnerCommission, type PartnerType } from "@/lib/partner-commissions";

/**
 * GET  /api/admin/partner-commissions — bitácora de comisiones calculadas.
 * POST /api/admin/partner-commissions:
 *   { action: "calculate", partnerId, orderId, orderValueCents } — calcula
 *     con calculatePartnerCommission() (nunca a mano) y registra 'pending'.
 *     Para real_estate_agent, isFirstBooking se determina automáticamente:
 *     ¿el cliente de la orden tiene alguna orden completada anterior?
 *   { action: "mark_paid", id }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.supabase
    .from("partner_commissions")
    .select("*, partners:partner_id ( name, partner_type )")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("admin/partner-commissions error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  return NextResponse.json({ partnerCommissions: data || [] }, { status: 200 });
}

interface Body {
  action?: string;
  partnerId?: string;
  orderId?: string;
  orderValueCents?: number;
  id?: string;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });
  const { supabase } = auth;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.action === "calculate") {
    if (!body.partnerId || !body.orderId || body.orderValueCents === undefined) {
      return NextResponse.json({ error: "partnerId, orderId y orderValueCents son obligatorios" }, { status: 400 });
    }

    const { data: partner, error: partnerError } = await supabase
      .from("partners")
      .select("partner_type")
      .eq("id", body.partnerId)
      .single();
    if (partnerError || !partner) {
      return NextResponse.json({ error: "Partner no encontrado" }, { status: 404 });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("user_id, quote_id, quotes(total)")
      .eq("id", body.orderId)
      .single();
    if (orderError || !order) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
    }

    // B-P5-1 fix (auditoría 2026-07-21): antes se confiaba orderValueCents
    // tal cual venía en el body, sin compararlo contra el valor real de la
    // orden -- un admin (o un cliente que interceptara la llamada si el
    // rol se relajara) podía calcular una comisión de $149,999.98 sobre
    // una orden de $373 con el mismo endpoint. Se valida contra
    // quotes.total (fuente de verdad, en dólares con centavos) con
    // tolerancia de 1 centavo por redondeo.
    const quoteTotalCents = Math.round(
      Number((order.quotes as unknown as { total: number }[] | null)?.[0]?.total ?? 0) * 100
    );
    if (quoteTotalCents <= 0) {
      return NextResponse.json(
        { error: "No se pudo verificar el valor real de la orden (cotización no encontrada)" },
        { status: 400 }
      );
    }
    if (Math.abs(body.orderValueCents - quoteTotalCents) > 1) {
      return NextResponse.json(
        {
          error: `orderValueCents (${body.orderValueCents}) no coincide con el total real de la orden (${quoteTotalCents} cents)`,
        },
        { status: 400 }
      );
    }

    // Evita comisión duplicada para el mismo (partner, orden): no hay
    // restricción UNIQUE en base de datos sobre partner_commissions, así
    // que se comprueba aquí antes de insertar. Sigue existiendo una
    // ventana de carrera entre este SELECT y el INSERT de abajo (no hay
    // compare-and-swap real sin la restricción UNIQUE a nivel de DB), pero
    // cierra el caso de uso normal de doble clic / doble submit del panel.
    const { data: existingCommission } = await supabase
      .from("partner_commissions")
      .select("id")
      .eq("partner_id", body.partnerId)
      .eq("order_id", body.orderId)
      .is("deleted_at", null)
      .limit(1);
    if (existingCommission && existingCommission.length > 0) {
      return NextResponse.json(
        { error: "Ya existe una comisión calculada para este partner y esta orden" },
        { status: 409 }
      );
    }

    let isFirstBooking = false;
    if (partner.partner_type === "real_estate_agent") {
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", order.user_id)
        .eq("status", "completed")
        .neq("id", body.orderId);
      isFirstBooking = (count ?? 0) === 0;
    }

    const commission = calculatePartnerCommission({
      partnerType: partner.partner_type as PartnerType,
      orderValueCents: body.orderValueCents,
      isFirstBooking,
    });

    const { data, error } = await supabase
      .from("partner_commissions")
      .insert({
        partner_id: body.partnerId,
        order_id: body.orderId,
        order_value_cents: body.orderValueCents,
        amount_cents: commission.amountCents,
        requires_t4a: commission.requiresT4A,
        description: commission.description,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe una comisión calculada para este partner y esta orden" },
          { status: 409 }
        );
      }
      console.error("admin/partner-commissions error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ partnerCommission: data, commission }, { status: 201 });
  }

  if (body.action === "mark_paid") {
    if (!body.id) return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });

    const { data: commission, error: commissionError } = await supabase
      .from("partner_commissions")
      .select("id, partner_id, requires_t4a, partners:partner_id ( tax_id_for_t4a )")
      .eq("id", body.id)
      .single();
    if (commissionError || !commission) {
      return NextResponse.json({ error: "Comisión no encontrada" }, { status: 404 });
    }

    // No se puede marcar como pagada una comisión que exige T4A (CRA) si el
    // partner no tiene tax_id_for_t4a registrado -- pagarla así deja al
    // negocio sin cómo emitir el T4A a fin de año.
    if (commission.requires_t4a) {
      const partnerData = commission.partners as unknown as { tax_id_for_t4a: string | null } | { tax_id_for_t4a: string | null }[] | null;
      const taxId = Array.isArray(partnerData) ? partnerData[0]?.tax_id_for_t4a : partnerData?.tax_id_for_t4a;
      if (!taxId || !taxId.trim()) {
        return NextResponse.json(
          { error: "Esta comisión requiere T4A y el partner no tiene tax_id_for_t4a registrado. Actualiza el partner antes de marcar como pagada." },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from("partner_commissions")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", body.id)
      .select()
      .single();
    if (error) {
      console.error("admin/partner-commissions error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ partnerCommission: data }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}

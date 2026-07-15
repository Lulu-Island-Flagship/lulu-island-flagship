import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
      .select("user_id")
      .eq("id", body.orderId)
      .single();
    if (orderError || !order) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ partnerCommission: data, commission }, { status: 201 });
  }

  if (body.action === "mark_paid") {
    if (!body.id) return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
    const { data, error } = await supabase
      .from("partner_commissions")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", body.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ partnerCommission: data }, { status: 200 });
  }

  return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
}

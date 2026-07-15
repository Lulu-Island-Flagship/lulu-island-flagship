import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { computeWalletCreditExpiryDate } from "@/lib/wallet";
import { dispatchCommunication } from "@/lib/send-communication";

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

const SURVEY_WALLET_CREDIT_CENTS = 1000; // $10, fijo por spec (E5.7)

/**
 * POST /api/client/pre-review-survey — { token, satisfied, complaintText? }
 *
 * v8.3 E5.7 — Encuesta interna 24h post-servicio. Otorga $10 de crédito a la
 * Billetera Lulu SIEMPRE que se complete (no depende de la respuesta -- el
 * incentivo es por el tiempo del cliente, nunca por una reseña pública,
 * B.2.18). Si complaintText no está vacío, abre un ticket de prioridad alta
 * (SLA 4h documentado) ANTES de que el cliente publique algo negativo.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { token?: string; satisfied?: boolean; complaintText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.token || typeof body.satisfied !== "boolean") {
    return NextResponse.json({ error: "token y satisfied son obligatorios" }, { status: 400 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, service_date")
    .eq("pre_review_survey_token", body.token)
    .maybeSingle();
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order || order.user_id !== user.id) {
    return NextResponse.json({ error: "Encuesta no encontrada" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("pre_review_surveys")
    .select("id")
    .eq("order_id", order.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Ya se respondió esta encuesta" }, { status: 409 });
  }

  const complaintText = body.complaintText?.trim() || null;

  let ticketId: string | null = null;
  if (complaintText) {
    const { data: ticket, error: ticketError } = await supabase
      .from("tickets_disputas")
      .insert({
        order_id: order.id,
        type: "dispute",
        priority: "high",
        status: "open",
        context: {
          source: "pre_review_survey",
          sla_hours: 4,
          complaint_text: complaintText,
        },
      })
      .select("id")
      .single();
    if (ticketError) return NextResponse.json({ error: ticketError.message }, { status: 500 });
    ticketId = ticket.id;
  }

  const { data: survey, error: surveyError } = await supabase
    .from("pre_review_surveys")
    .insert({
      order_id: order.id,
      user_id: user.id,
      satisfied: body.satisfied,
      complaint_text: complaintText,
      wallet_credit_cents: SURVEY_WALLET_CREDIT_CENTS,
      ticket_id: ticketId,
    })
    .select()
    .single();
  if (surveyError) return NextResponse.json({ error: surveyError.message }, { status: 500 });

  // Otorgar el crédito de billetera (mismo patrón que /api/admin/wallet POST,
  // pero server-side sin pasar por el endpoint admin -- este SÍ es el
  // "sistema" otorgando, no un admin a mano).
  const { data: wallet } = await supabase
    .from("client_wallets")
    .select("id, balance")
    .eq("user_id", user.id)
    .maybeSingle();

  if (wallet) {
    const nowIso = new Date().toISOString();
    const newBalance = wallet.balance + SURVEY_WALLET_CREDIT_CENTS;
    await supabase.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      user_id: user.id,
      order_id: order.id,
      type: "credit",
      amount: SURVEY_WALLET_CREDIT_CENTS,
      balance_after: newBalance,
      description: "Encuesta interna post-servicio",
      expires_at: computeWalletCreditExpiryDate(nowIso),
    });
    await supabase.from("client_wallets").update({ balance: newBalance, updated_at: nowIso }).eq("id", wallet.id);
  }

  // v8.3 E5.12: "recordatorio de recomendación del líder" -- si el cliente
  // quedó satisfecho, se aprovecha este mismo momento (ya está pensando en
  // el servicio) para invitarlo a recomendar al líder de su equipo. Se
  // identifica al líder como quien dejó la nota de cierre (mismo criterio
  // que la "nota del líder" de la galería, E5.5); si no hay nota (nadie
  // dejó una), se omite en vez de inventar un nombre.
  if (body.satisfied) {
    const { data: noteLog } = await supabase
      .from("service_logs")
      .select("employee_id")
      .eq("order_id", order.id)
      .eq("event_type", "note")
      .not("notes", "is", null)
      .order("timestamp", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (noteLog?.employee_id) {
      const { data: employee } = await supabase
        .from("employees")
        .select("name")
        .eq("id", noteLog.employee_id)
        .maybeSingle();

      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("preferred_languages")
        .eq("user_id", user.id)
        .maybeSingle();
      const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] || "en") as
        | "en"
        | "es"
        | "zh";

      // TODO(dueño/producto): referral_link real depende del programa
      // "Lulu Ambassador" (E5.13, aún no construido en esta sesión) -- por
      // ahora enlaza a la home. Actualizar cuando exista el código único.
      await dispatchCommunication(supabase, {
        eventKey: "leader_recommendation_reminder",
        userId: user.id,
        orderId: order.id,
        language,
        vars: {
          client_name: "there",
          leader_name: employee?.name || "your cleaning team",
          referral_link: process.env.NEXT_PUBLIC_APP_URL || "https://app.luluisland.ca",
        },
      });
    }
  }

  return NextResponse.json({ survey, walletCreditCents: SURVEY_WALLET_CREDIT_CENTS }, { status: 201 });
}

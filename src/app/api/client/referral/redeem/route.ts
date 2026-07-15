import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeReferralCode,
  decideSameIpFraudFlag,
  decideReferralRedemptionAttempt,
  computeReferralBanExpiry,
  isReferralBanActive,
} from "@/lib/referrals";

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

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

/**
 * POST /api/client/referral/redeem — { code, mentionedEmployeeId? }
 *
 * v8.3 E5.13 "Lulu Ambassador". Canje UNA sola vez por cliente (referred_by_code
 * inmutable una vez asignado). El crédito de $30/$30 (y el bono de $5 del
 * líder) NO se otorga aquí -- se otorga cuando la primera orden del
 * referido se completa (cron referral-credit-grant), para no pagar por
 * registros sin servicio real. Esta ruta solo valida, registra el intento
 * (para el anti-fraude "3 códigos distintos") y crea el vínculo pendiente.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { code?: string; mentionedEmployeeId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.code || typeof body.code !== "string") {
    return NextResponse.json({ error: "code es obligatorio" }, { status: 400 });
  }

  const clientIp = getClientIp(request);
  const code = normalizeReferralCode(body.code);
  const nowIso = new Date().toISOString();

  const { data: myProfile, error: myProfileError } = await supabase
    .from("client_profiles")
    .select("id, referred_by_code, referral_banned_until")
    .eq("user_id", user.id)
    .maybeSingle();
  if (myProfileError) return NextResponse.json({ error: myProfileError.message }, { status: 500 });
  if (!myProfile) return NextResponse.json({ error: "Client profile not found" }, { status: 404 });

  // Ban temporal activo (3+ códigos distintos intentados antes) -- rechaza
  // sin siquiera mirar el código.
  if (isReferralBanActive(myProfile.referral_banned_until, nowIso)) {
    await supabase.from("referral_redemption_attempts").insert({
      referred_user_id: user.id,
      code,
      ip_address: clientIp,
      result: "rejected_banned",
    });
    return NextResponse.json(
      { error: "Referral redemption is temporarily disabled on this account" },
      { status: 403 }
    );
  }

  if (myProfile.referred_by_code) {
    await supabase.from("referral_redemption_attempts").insert({
      referred_user_id: user.id,
      code,
      ip_address: clientIp,
      result: "rejected_already_referred",
    });
    return NextResponse.json({ error: "This account already redeemed a referral code" }, { status: 409 });
  }

  const { data: referrerProfile, error: referrerError } = await supabase
    .from("client_profiles")
    .select("id, user_id, referral_code")
    .eq("referral_code", code)
    .maybeSingle();
  if (referrerError) return NextResponse.json({ error: referrerError.message }, { status: 500 });

  if (!referrerProfile) {
    await supabase.from("referral_redemption_attempts").insert({
      referred_user_id: user.id,
      code,
      ip_address: clientIp,
      result: "rejected_invalid_code",
    });
    return NextResponse.json({ error: "Invalid referral code" }, { status: 404 });
  }

  if (referrerProfile.user_id === user.id) {
    await supabase.from("referral_redemption_attempts").insert({
      referred_user_id: user.id,
      code,
      ip_address: clientIp,
      result: "rejected_self",
    });
    return NextResponse.json({ error: "You cannot redeem your own referral code" }, { status: 400 });
  }

  // Anti-fraude: contar códigos DISTINTOS intentados por este usuario,
  // incluyendo intentos previos rechazados por invalidez -- el ban es por
  // patrón de comportamiento, no solo por canjes exitosos.
  const { data: priorAttempts } = await supabase
    .from("referral_redemption_attempts")
    .select("code")
    .eq("referred_user_id", user.id);

  const decision = decideReferralRedemptionAttempt((priorAttempts || []).map((a) => a.code), code);

  if (decision.banned) {
    await supabase
      .from("client_profiles")
      .update({ referral_banned_until: computeReferralBanExpiry(nowIso), updated_at: nowIso })
      .eq("id", myProfile.id);
    await supabase.from("referral_redemption_attempts").insert({
      referred_user_id: user.id,
      code,
      ip_address: clientIp,
      result: "rejected_banned",
    });
    return NextResponse.json(
      { error: decision.reason, code: "REFERRAL_ABUSE_BANNED" },
      { status: 403 }
    );
  }

  // Señal de misma IP: se compara contra la IP del último quote del
  // referente (consent_ip, ya existe en `quotes`) como mejor proxy
  // disponible -- no guardamos la IP de signup del referente por separado.
  const { data: referrerLastQuote } = await supabase
    .from("quotes")
    .select("consent_ip")
    .eq("user_id", referrerProfile.user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sameIpFlag = decideSameIpFraudFlag(referrerLastQuote?.consent_ip ?? null, clientIp);

  const { data: referral, error: referralError } = await supabase
    .from("referrals")
    .insert({
      referrer_user_id: referrerProfile.user_id,
      referred_user_id: user.id,
      code,
      referrer_signup_ip: referrerLastQuote?.consent_ip ?? null,
      referred_signup_ip: clientIp,
      same_ip_flag: sameIpFlag,
      mentioned_employee_id: body.mentionedEmployeeId || null,
      status: sameIpFlag ? "flagged" : "pending",
    })
    .select()
    .single();

  if (referralError) return NextResponse.json({ error: referralError.message }, { status: 500 });

  await supabase
    .from("client_profiles")
    .update({ referred_by_code: code, referral_signup_ip: clientIp, updated_at: nowIso })
    .eq("id", myProfile.id);

  await supabase.from("referral_redemption_attempts").insert({
    referred_user_id: user.id,
    code,
    ip_address: clientIp,
    result: "accepted",
  });

  return NextResponse.json(
    {
      referral,
      sameIpFlag,
      message: sameIpFlag
        ? "Code applied, pending manual review (shared IP detected)"
        : "Code applied. Credit is granted once your first service is completed.",
    },
    { status: 201 }
  );
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import {
  normalizeReferralCode,
  decideSameIpFraudFlag,
  decideReferralRedemptionAttempt,
  computeReferralBanExpiry,
  isReferralBanActive,
} from "@/lib/referrals";

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

  // Fix (auditoría en vivo 2026-08-01): esto devolvía 404 "Client profile
  // not found" para cualquier cliente que todavía no tuviera fila en
  // client_profiles -- exactamente el caso de alguien que se acaba de
  // registrar PORQUE un amigo lo invitó y quiere canjear el código como su
  // primera acción real en la cuenta, antes de haber cotizado nada (mismo
  // patrón de bug ya confirmado y corregido en
  // /api/client/communication-preferences: la tabla solo se crea hoy en la
  // primera cotización, no hay trigger en auth.users). Se crea la fila con
  // los defaults de la migración 001 si falta, igual que ya hace
  // getOrCreateClientProfile() en /api/client/properties -- este endpoint
  // no puede reusar esa función directamente (es local a ese route.ts, no
  // exportada; mismo patrón ya duplicado en api/quote y
  // api/admin/phone-booking), así que se replica aquí el mismo
  // select-then-insert.
  let myProfile: { id: string; referred_by_code: string | null; referral_banned_until: string | null };
  const { data: existingProfile, error: myProfileError } = await supabase
    .from("client_profiles")
    .select("id, referred_by_code, referral_banned_until")
    .eq("user_id", user.id)
    .maybeSingle();
  if (myProfileError) {
    console.error("myProfileError:", myProfileError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (existingProfile) {
    myProfile = existingProfile;
  } else {
    const { data: createdProfile, error: createError } = await supabase
      .from("client_profiles")
      .insert({ user_id: user.id, score: 50, services_count: 0, disputes_count: 0, no_show_count: 0, account_type: "b2c" })
      .select("id, referred_by_code, referral_banned_until")
      .single();
    if (createError || !createdProfile) {
      console.error("referral/redeem: could not create client profile:", createError);
      return NextResponse.json({ error: "Could not process redemption" }, { status: 500 });
    }
    myProfile = createdProfile;
  }

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
  if (referrerError) {
    console.error("referrerError:", referrerError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
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

  // v8.3 fix (auditoría seguridad 2026-07-26): mentionedEmployeeId se insertaba
  // sin validar que ese empleado existiera y estuviera activo -- un id
  // arbitrario (ajeno, inactivo o borrado) quedaba guardado sin más
  // comprobación. Se verifica contra `employees` (is_active=true,
  // deleted_at IS NULL) antes de insertar; si no matchea, se rechaza el
  // canje completo con un mensaje genérico (sin filtrar detalles técnicos).
  let mentionedEmployeeId: string | null = null;
  if (body.mentionedEmployeeId) {
    const { data: mentionedEmployee, error: mentionedEmployeeError } = await supabase
      .from("employees")
      .select("id")
      .eq("id", body.mentionedEmployeeId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (mentionedEmployeeError) {
      console.error("referral/redeem mentionedEmployeeId lookup error:", mentionedEmployeeError);
      return NextResponse.json({ error: "No se pudo procesar el canje" }, { status: 500 });
    }
    if (!mentionedEmployee) {
      return NextResponse.json(
        { error: "The mentioned employee is invalid or no longer active" },
        { status: 400 }
      );
    }
    mentionedEmployeeId = mentionedEmployee.id;
  }

  const { data: referral, error: referralError } = await supabase
    .from("referrals")
    .insert({
      referrer_user_id: referrerProfile.user_id,
      referred_user_id: user.id,
      code,
      referrer_signup_ip: referrerLastQuote?.consent_ip ?? null,
      referred_signup_ip: clientIp,
      same_ip_flag: sameIpFlag,
      mentioned_employee_id: mentionedEmployeeId,
      status: sameIpFlag ? "flagged" : "pending",
    })
    .select()
    .single();

  if (referralError) {

    console.error("referralError:", referralError);

    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });

  }
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

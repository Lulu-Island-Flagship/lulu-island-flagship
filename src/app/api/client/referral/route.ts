import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isEligibleForReferralCode, buildReferralCodeCandidate, REFERRAL_CREDIT_CENTS } from "@/lib/referrals";

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

const MAX_CODE_GENERATION_ATTEMPTS = 5;

/**
 * GET /api/client/referral — v8.3 E5.13 "Lulu Ambassador".
 *
 * Elegibilidad VIP (>5 servicios, score >80). Si es elegible y todavía no
 * tiene código, lo genera bajo demanda (lazy) -- nadie recibe un código sin
 * pedirlo, evitando ensuciar la tabla con códigos nunca usados. Reintenta
 * en caso de colisión de UNIQUE (baja probabilidad, pero real).
 */
export async function GET(_request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fix (auditoría en vivo 2026-08-01, ronda 3): mismo patrón ya corregido
  // en POST /api/client/referral/redeem -- un cliente recién creado (sin
  // fila en client_profiles todavía, porque solo se crea en la primera
  // cotización) recibía 404 "Client profile not found" aquí. El frontend
  // (referidos/page.tsx) traga ese error silenciosamente y muestra
  // "not eligible", así que no se veía como un error visible, pero seguía
  // siendo el mismo bug de fondo. Se crea la fila si falta, igual que en
  // redeem/route.ts y properties/route.ts (getOrCreateClientProfile()).
  let profile: { id: string; services_count: number | null; score: number | null; referral_code: string | null };
  const { data: existingProfile, error: profileError } = await supabase
    .from("client_profiles")
    .select("id, services_count, score, referral_code")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 });
  if (existingProfile) {
    profile = existingProfile;
  } else {
    const { data: createdProfile, error: createError } = await supabase
      .from("client_profiles")
      .insert({ user_id: user.id, score: 50, services_count: 0, disputes_count: 0, no_show_count: 0, account_type: "b2c" })
      .select("id, services_count, score, referral_code")
      .single();
    if (createError || !createdProfile) {
      console.error("referral GET: could not create client profile:", createError);
      return NextResponse.json({ error: "Could not load referral status" }, { status: 500 });
    }
    profile = createdProfile;
  }

  const eligible = isEligibleForReferralCode(profile.services_count || 0, profile.score || 0);

  if (!eligible) {
    return NextResponse.json({ eligible: false, code: null }, { status: 200 });
  }

  if (profile.referral_code) {
    return NextResponse.json(
      { eligible: true, code: profile.referral_code, creditCents: REFERRAL_CREDIT_CENTS },
      { status: 200 }
    );
  }

  const { data: userInfo } = await supabase.auth.getUser();
  const displayName = (userInfo?.user?.email || "lulu").split("@")[0];

  for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = buildReferralCodeCandidate(displayName, suffix);

    const { data: updated, error: updateError } = await supabase
      .from("client_profiles")
      .update({ referral_code: candidate, updated_at: new Date().toISOString() })
      .eq("id", profile.id)
      .select("referral_code")
      .single();

    if (!updateError && updated) {
      return NextResponse.json(
        { eligible: true, code: updated.referral_code, creditCents: REFERRAL_CREDIT_CENTS },
        { status: 200 }
      );
    }
    // updateError.code 23505 = unique_violation -- reintentar con otro sufijo
  }

  return NextResponse.json({ error: "Could not generate a unique code, try again" }, { status: 500 });
}

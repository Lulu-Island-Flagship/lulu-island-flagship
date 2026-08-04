import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isEligibleForReferralCode, buildReferralCodeCandidate, REFERRAL_CREDIT_CENTS } from "@/lib/referrals";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, secure: true, sameSite: "lax" });
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

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  // Fix (auditoría de integridad de datos 2026-08-01): un GET no debe tener
  // side effects (viola la semántica HTTP -- GET debe ser seguro/idempotente,
  // y un cliente/proxy puede reintentar o precargar un GET sin que eso deba
  // crear datos). La versión anterior insertaba una fila en client_profiles
  // como side effect de esta lectura. Ahora, si el perfil todavía no existe
  // (cliente recién creado, sin cotización todavía), se devuelve
  // `{eligible: false}` directamente, sin crear nada -- la creación del
  // perfil vive en el flujo real que lo necesita (primera cotización, ver
  // getOrCreateClientProfile() usado por /api/client/quotes y
  // /api/client/referral/redeem).
  const { data: profile, error: profileError } = await supabase
    .from("client_profiles")
    .select("id, services_count, score, referral_code")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    console.error("profileError:", profileError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ eligible: false, code: null }, { status: 200 });
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

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getClientIp(request: NextRequest): string {
  // Vercel headers primero, luego fallback
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
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
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // Rate limiting por IP usando tabla en Supabase (funciona en Vercel serverless)
    const clientIp = getClientIp(request);
    const { data: rateLimitData, error: rateLimitError } = await supabase.rpc(
      "check_rate_limit",
      { p_ip_address: clientIp, p_max_requests: 3 }
    );

    if (rateLimitError) {
      console.error("Rate limit check error:", rateLimitError);
      // Si falla el rate limit, permitir pero loggear (fail open para no bloquear usuarios legítimos)
    } else if (rateLimitData && !rateLimitData[0]?.allowed) {
      const resetAt = rateLimitData[0]?.reset_at;
      return NextResponse.json(
        { error: "Rate limit exceeded. Maximum 3 quotes per 24 hours." },
        { status: 429, headers: { "X-RateLimit-Reset": resetAt ? String(new Date(resetAt).getTime()) : "" } }
      );
    }

    const body = await request.json();
    const { serviceType, bedrooms, bathrooms, squareFeet, petsCount, petsType, residents, daysSinceCleaning, address, zone, postalCode, basePrice, organicMultiplier, organicAdjustment, recencyMultiplier, recencyAdjustment, zoneSurcharge, logisticsSurcharge, subtotal, gst, pst, total, holdAmount, priceFrozenUntil, status, consentTc, consentPipa, consentMarketing, clientScore } = body;

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("quotes")
      .insert({
        user_id: user.id,
        service_type: serviceType,
        bedrooms,
        bathrooms,
        square_feet: squareFeet,
        pets_count: petsCount,
        pets_type: petsType,
        residents,
        days_since_cleaning: daysSinceCleaning,
        address,
        zone,
        postal_code: postalCode,
        base_price: basePrice,
        organic_multiplier: organicMultiplier,
        organic_adjustment: organicAdjustment,
        recency_multiplier: recencyMultiplier,
        recency_adjustment: recencyAdjustment,
        zone_surcharge: zoneSurcharge,
        logistics_surcharge: logisticsSurcharge,
        subtotal,
        gst,
        pst,
        total,
        hold_amount: holdAmount,
        price_frozen_until: priceFrozenUntil,
        status,
        consent_tc: consentTc,
        consent_pipa: consentPipa,
        consent_marketing: consentMarketing,
        client_score: clientScore,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quote: data, quoteId: data.id }, { status: 201 });
  } catch (err: Error | unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void _request;
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("quotes")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quotes: data }, { status: 200 });
  } catch (err: Error | unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

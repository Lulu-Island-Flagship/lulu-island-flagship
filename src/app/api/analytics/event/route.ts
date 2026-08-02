import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
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

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.ip || "unknown";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, variant, timestamp } = body;

    if (!event || !timestamp) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Rate limit: max 30 events per IP per day (generous for legitimate tracking)
    const ip = getClientIp(request);
    const { data: rateData, error: rateError } = await supabase.rpc(
      "check_rate_limit",
      {
        p_ip_address: ip,
        p_max_requests: 30,
      }
    );

    if (rateError) {
      console.error("Rate limit error:", rateError);
      // Don't block on rate limit check failure, just log
    } else if (rateData && !rateData.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    const { data: { user } } = await supabase.auth.getUser();

    // Insert lightweight analytics event
    const { error } = await supabase
      .from("analytics_events")
      .insert({
        event_type: event,
        variant: variant || null,
        user_id: user?.id || null,
        timestamp: timestamp,
        page_url: request.headers.get("referer") || null,
        user_agent: request.headers.get("user-agent") || null,
      });

    if (error) {
      console.error("Analytics insert error:", error);
      return NextResponse.json({ error: "Failed to log event" }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

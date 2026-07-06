import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

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
    const body = await request.json();
    const {
      quoteId,
      serviceDate,
      serviceTime,
      paymentMethodId,
      stripeCustomerId,
      holdAmount,
    } = body;

    if (!quoteId || !serviceDate || !serviceTime || !paymentMethodId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Build ISO datetime from date + time
    const serviceDatetime = new Date(`${serviceDate}T${serviceTime}:00`);
    if (isNaN(serviceDatetime.getTime())) {
      return NextResponse.json(
        { error: "Invalid date or time" },
        { status: 400 }
      );
    }

    // Ensure datetime is at least 24h in the future
    const minDate = new Date();
    minDate.setHours(minDate.getHours() + 24);
    if (serviceDatetime < minDate) {
      return NextResponse.json(
        { error: "Service must be scheduled at least 24 hours in advance" },
        { status: 400 }
      );
    }

    // Verify quote exists and belongs to user
    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, price_frozen_until")
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .single();

    if (quoteError || !quoteRow) {
      return NextResponse.json(
        { error: "Quote not found or unauthorized" },
        { status: 404 }
      );
    }

    // Check price freeze
    const frozenUntil = new Date(quoteRow.price_frozen_until);
    if (frozenUntil < new Date()) {
      return NextResponse.json(
        { error: "Quote has expired. Please generate a new quote." },
        { status: 410 }
      );
    }

    // Create order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        quote_id: quoteId,
        user_id: user.id,
        service_date: serviceDate,
        service_time: serviceTime,
        service_datetime: serviceDatetime.toISOString(),
        status: "confirmed",
        stripe_customer_id: stripeCustomerId || null,
        stripe_payment_method_id: paymentMethodId,
        payment_option: "card",
        hold_amount: holdAmount || 0,
        cancellation_window_hours: 72,
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order insert error:", orderError);
      return NextResponse.json(
        { error: orderError.message },
        { status: 500 }
      );
    }

    // Update quote status to reserved
    await supabase
      .from("quotes")
      .update({ status: "reserved" })
      .eq("id", quoteId);

    return NextResponse.json(
      { orderId: order.id, status: "confirmed" },
      { status: 201 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Confirm reservation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

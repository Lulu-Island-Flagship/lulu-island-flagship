import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";

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
      stripeSetupIntentId,
      holdAmount,
    } = body;

    if (!quoteId || !serviceDate || !serviceTime || !paymentMethodId || !stripeSetupIntentId) {
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

    // Build ISO datetime from date + time (Vancouver timezone)
    const serviceDatetime = new Date(`${serviceDate}T${serviceTime}:00-07:00`); // PST (Vancouver)
    if (isNaN(serviceDatetime.getTime())) {
      return NextResponse.json(
        { error: "Invalid date or time" },
        { status: 400 }
      );
    }

    // Validate date range using Vancouver timezone
    const vancouverNowStr = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" });
    const vancouverToday = new Date(vancouverNowStr.split(",")[0] + "T12:00:00-07:00");
    vancouverToday.setHours(0, 0, 0, 0);

    const serviceDateObj = new Date(serviceDate + "T12:00:00-07:00");
    serviceDateObj.setHours(0, 0, 0, 0);

    const tomorrow = new Date(vancouverToday);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const oneYearLater = new Date(vancouverToday);
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);

    if (serviceDateObj < tomorrow) {
      return NextResponse.json(
        { error: "Service must be scheduled at least 1 day in advance" },
        { status: 400 }
      );
    }

    if (serviceDateObj > oneYearLater) {
      return NextResponse.json(
        { error: "Service cannot be scheduled more than 1 year in advance" },
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

    // Check for existing order (prevent double-submit)
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id, status")
      .eq("quote_id", quoteId)
      .neq("status", "cancelled")
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json(
        { orderId: existingOrder.id, status: existingOrder.status, message: "Order already exists for this quote" },
        { status: 409 }
      );
    }

    // Verify SetupIntent with Stripe (security: don't trust client-provided paymentMethodId alone)
    const stripe = assertStripe();
    const setupIntent = await stripe.setupIntents.retrieve(stripeSetupIntentId);

    if (setupIntent.status !== "succeeded") {
      return NextResponse.json(
        { error: "Payment method not verified. Please complete card setup." },
        { status: 402 }
      );
    }

    // Verify the payment method belongs to this SetupIntent
    if (setupIntent.payment_method !== paymentMethodId) {
      return NextResponse.json(
        { error: "Payment method mismatch. Please try again." },
        { status: 400 }
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
        stripe_setup_intent_id: stripeSetupIntentId,
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

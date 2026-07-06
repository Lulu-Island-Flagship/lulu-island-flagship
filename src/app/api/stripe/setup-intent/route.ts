import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, email } = body;

    if (!userId || !email) {
      return NextResponse.json(
        { error: "Missing userId or email" },
        { status: 400 }
      );
    }

    const stripe = assertStripe();

    // Create or retrieve Stripe Customer
    // In production, you'd look up existing customer by metadata/userId first
    const customer = await stripe.customers.create({
      email,
      metadata: { supabase_user_id: userId },
    });

    // Create SetupIntent (tokenization, $0 charge)
    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session", // for future charges (Batch Capture)
    });

    return NextResponse.json(
      {
        clientSecret: setupIntent.client_secret,
        customerId: customer.id,
        setupIntentId: setupIntent.id,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("SetupIntent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

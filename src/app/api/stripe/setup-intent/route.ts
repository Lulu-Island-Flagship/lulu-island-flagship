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

    // Buscar customer existente por email (Stripe no permite filtrar por metadata en list)
    let customer;
    const existingCustomers = await stripe.customers.list({
      limit: 1,
      email: email,
    });

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      // Crear nuevo customer solo si no existe
      customer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
    }

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

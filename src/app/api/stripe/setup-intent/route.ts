import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import type Stripe from "stripe";

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
    const { userId, quoteId } = body;

    if (!userId || !quoteId) {
      return NextResponse.json(
        { error: "Missing userId or quoteId" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user || user.id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // El email siempre viene de la sesión autenticada; nunca del cliente.
    const email = user.email;

    // Seguridad: verificar que la quote pertenece al usuario autenticado
    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, user_id")
      .eq("id", quoteId)
      .eq("user_id", user.id)
      .single();

    if (quoteError || !quoteRow) {
      return NextResponse.json(
        { error: "Quote not found or unauthorized" },
        { status: 404 }
      );
    }

    if (quoteRow.status !== "pending") {
      return NextResponse.json(
        { error: "Quote is not available for reservation" },
        { status: 409 }
      );
    }

    const stripe = assertStripe();

    // Buscar customer existente: primero en nuestro perfil, luego por email de la sesión.
    // Nunca usamos email del body para evitar secuestro de customer de Stripe.
    let customer;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (profile?.stripe_customer_id) {
      try {
        customer = await stripe.customers.retrieve(profile.stripe_customer_id);
        if (customer.deleted) customer = undefined;
      } catch {
        customer = undefined;
      }
    }

    if (!customer && email) {
      const existingCustomers = await stripe.customers.list({
        limit: 1,
        email: email,
      });
      if (existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];
      }
    }

    if (!customer) {
      // Crear nuevo customer; email opcional para usuarios de teléfono
      const customerData: Stripe.CustomerCreateParams = {
        metadata: { supabase_user_id: userId },
      };
      if (email) customerData.email = email;
      customer = await stripe.customers.create(customerData);
    }

    // Persistir stripe_customer_id para futuras búsquedas
    await supabase
      .from("client_profiles")
      .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

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

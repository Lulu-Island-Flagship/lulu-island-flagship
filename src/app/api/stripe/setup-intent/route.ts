import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import type Stripe from "stripe";
import { safeErrorResponse } from "@/lib/api-errors";

// Fix (auditoría externa, verificado 2026-07-31): antes, si faltaban las
// env vars de Supabase, se usaban placeholders en silencio (ver mismo fix
// en src/app/api/stripe/confirm/route.ts). Ahora se lanza un error claro.
function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurado");
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY no está configurado");
  }
  return key;
}

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

    // Persistir stripe_customer_id para futuras búsquedas.
    // Fix (auditoría externa, verificado 2026-07-31): este UPDATE no
    // chequeaba su error. Si fallaba, el customer YA existía en Stripe pero
    // client_profiles.stripe_customer_id quedaba desincronizado -- la
    // próxima vez este mismo endpoint intentaría buscarlo por email de
    // nuevo (falla silenciosa recuperable), pero mientras tanto cualquier
    // código que lea client_profiles.stripe_customer_id directamente (ej.
    // reconciliación, wallet, refunds) no encontraría el customer real.
    // No abortamos la creación del SetupIntent (ya se creó y es válido;
    // el cliente puede seguir con el pago), pero sí lo logueamos fuerte
    // para que quede evidencia de la desincronización.
    const { error: profileUpdateError } = await supabase
      .from("client_profiles")
      .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (profileUpdateError) {
      console.error(
        `CRITICAL: fallo al persistir stripe_customer_id (${customer.id}) en client_profiles para user ${user.id}. ` +
          `El customer de Stripe existe pero queda desincronizado con nuestro perfil. Error:`,
        profileUpdateError
      );
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
    return safeErrorResponse(err);
  }
}

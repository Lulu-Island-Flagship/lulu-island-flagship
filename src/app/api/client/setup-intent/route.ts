
import { NextResponse } from "next/server";
import { assertStripe } from "@/lib/stripe";
import { safeErrorResponse } from "@/lib/api-errors";
import { requireClientCaller } from "@/lib/require-client-caller";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
/**
 * POST /api/client/setup-intent — crea un SetupIntent sin requerir quoteId.
 * Para usar desde la página de billetera al agregar un método de pago.
 */
export async function POST() {
  try {
    const supabase = await createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const clientGuard = await requireClientCaller(supabase, user.id);
    if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

    const stripe = assertStripe();

    // Buscar o crear Stripe Customer
    let customerId: string;
    const { data: profile } = await supabase
      .from("client_profiles")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.stripe_customer_id) {
      try {
        const c = await stripe.customers.retrieve(profile.stripe_customer_id);
        if (!c.deleted) {
          customerId = c.id;
        } else {
          customerId = await createCustomer(stripe, supabase, user);
        }
      } catch {
        customerId = await createCustomer(stripe, supabase, user);
      }
    } else {
      // Buscar por email antes de crear
      if (user.email) {
        const existing = await stripe.customers.list({ limit: 1, email: user.email });
        if (existing.data.length > 0) {
          customerId = existing.data[0].id;
        } else {
          customerId = await createCustomer(stripe, supabase, user);
        }
      } else {
        customerId = await createCustomer(stripe, supabase, user);
      }
    }

    // Persistir el customer_id si no estaba guardado
    if (!profile?.stripe_customer_id || profile.stripe_customer_id !== customerId) {
      await supabase
        .from("client_profiles")
        .upsert({ user_id: user.id, stripe_customer_id: customerId, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId,
    }, { status: 200 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

async function createCustomer(stripe: ReturnType<typeof assertStripe>, supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>, user: { id: string; email?: string | undefined }): Promise<string> {
  const customer = await stripe.customers.create({
    ...(user.email ? { email: user.email } : {}),
    metadata: { supabase_user_id: user.id },
  });
  await supabase
    .from("client_profiles")
    .upsert({ user_id: user.id, stripe_customer_id: customer.id, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  return customer.id;
}

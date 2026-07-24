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

/**
 * POST /api/stripe/wallet-intent
 *
 * Feature 2026-07-21: crea el PaymentIntent real de Stripe que cobra el
 * 100% de una cotización de una sola vez vía Alipay o WeChat Pay
 * (decisión de negocio: a diferencia de tarjeta/Apple Pay, estos medios no
 * se pueden recargar off_session semanas después de forma confiable, así
 * que se cobra todo por adelantado; el cliente igual registra una tarjeta
 * de respaldo por separado vía /api/stripe/setup-intent, solo para cargos
 * extra reales -- daño, tiempo adicional, cancelación tardía).
 *
 * El monto SIEMPRE se calcula server-side desde quotes.total (nunca se
 * confía en un monto del cliente) -- mismo principio que /api/stripe/confirm.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { quoteId, walletType } = body;

    if (!quoteId || (walletType !== "alipay" && walletType !== "wechat_pay")) {
      return NextResponse.json(
        { error: "Missing quoteId or invalid walletType (must be 'alipay' or 'wechat_pay')" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Seguridad: la quote debe pertenecer al usuario autenticado y seguir
    // vigente (mismo chequeo que /api/stripe/setup-intent).
    const { data: quoteRow, error: quoteError } = await supabase
      .from("quotes")
      .select("id, status, user_id, total, price_frozen_until")
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

    if (new Date(quoteRow.price_frozen_until) < new Date()) {
      return NextResponse.json(
        { error: "Quote has expired. Please generate a new quote." },
        { status: 410 }
      );
    }

    // quotes.total sigue en dólares (columna fuera de alcance de la
    // migración 229 que unificó orders a centavos) -- se escala x100 aquí,
    // igual que en /api/stripe/confirm.
    const amountCents = Math.round(Number(quoteRow.total) * 100);
    if (amountCents <= 0) {
      return NextResponse.json({ error: "Invalid quote amount" }, { status: 400 });
    }

    const stripe = assertStripe();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "cad",
      payment_method_types: [walletType],
      metadata: {
        quote_id: quoteId,
        user_id: user.id,
        payment_option: walletType,
      },
    });

    return NextResponse.json(
      {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amountCents,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Wallet PaymentIntent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
import { assertStripe } from "@/lib/stripe";
import { ensureClientForAuthUser } from "@/lib/client-module/client-service";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
    },
  });
}

/**
 * GET /api/client/payment-methods — lista las tarjetas guardadas del cliente autenticado.
 * DELETE /api/client/payment-methods?id=XXX — elimina (marca como removed).
 * PATCH /api/client/payment-methods — { id, is_default } — marca como default.
 * POST /api/client/payment-methods — { setupIntentId } — guarda una tarjeta después de confirmar el SetupIntent.
 */

export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

  try {
    const { clientId } = await ensureClientForAuthUser(
      { authUserId: user.id, email: user.email ?? null, phone: user.phone ?? null },
      supabase
    );

    const { data: methods, error } = await supabase
      .from("client_payment_methods")
      .select("id, method_type, provider, last_four, expiry_month, expiry_year, is_default, created_at")
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("payment-methods GET error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ methods: methods || [] }, { status: 200 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

  try {
    const body = await request.json();
    const { setupIntentId } = body;
    if (!setupIntentId || typeof setupIntentId !== "string") {
      return NextResponse.json({ error: "Missing setupIntentId" }, { status: 400 });
    }

    const stripe = assertStripe();

    // Recuperar el SetupIntent para obtener el payment_method
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== "succeeded" || !setupIntent.payment_method) {
      return NextResponse.json({ error: "SetupIntent not succeeded or missing payment method" }, { status: 400 });
    }

    const pmId = typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method.id;

    // Obtener metadata de la tarjeta desde Stripe
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.type !== "card" || !pm.card) {
      return NextResponse.json({ error: "Payment method is not a card" }, { status: 400 });
    }

    const { clientId } = await ensureClientForAuthUser(
      { authUserId: user.id, email: user.email ?? null, phone: user.phone ?? null },
      supabase
    );

    // Verificar si ya existe este payment method
    const { data: existing } = await supabase
      .from("client_payment_methods")
      .select("id")
      .eq("client_id", clientId)
      .eq("provider_token", pmId)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ method: existing, duplicated: true }, { status: 200 });
    }

    // Si es la primera tarjeta, marcarla como default automáticamente
    const { count } = await supabase
      .from("client_payment_methods")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("status", "active");

    const isDefault = (count ?? 0) === 0;

    const { data: created, error } = await supabase
      .from("client_payment_methods")
      .insert({
        client_id: clientId,
        method_type: "credit_card",
        provider: "stripe",
        provider_token: pmId,
        last_four: pm.card.last4,
        expiry_month: pm.card.exp_month,
        expiry_year: pm.card.exp_year,
        is_default: isDefault,
        status: "active",
      })
      .select("id, method_type, provider, last_four, expiry_month, expiry_year, is_default, created_at")
      .single();

    if (error) {
      console.error("payment-methods POST insert error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ method: created }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { clientId } = await ensureClientForAuthUser(
      { authUserId: user.id, email: user.email ?? null, phone: user.phone ?? null },
      supabase
    );

    // Verificar ownership
    const { data: method } = await supabase
      .from("client_payment_methods")
      .select("id, client_id")
      .eq("id", id)
      .eq("client_id", clientId)
      .single();

    if (!method) return NextResponse.json({ error: "Payment method not found" }, { status: 404 });

    // Soft-delete: marcar como removed
    const { error } = await supabase
      .from("client_payment_methods")
      .update({ status: "removed", is_default: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("payment-methods DELETE error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ removed: true }, { status: 200 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });

  try {
    const body = await request.json();
    const { id, is_default } = body;
    if (!id || typeof is_default !== "boolean") {
      return NextResponse.json({ error: "Missing id or is_default" }, { status: 400 });
    }

    const { clientId } = await ensureClientForAuthUser(
      { authUserId: user.id, email: user.email ?? null, phone: user.phone ?? null },
      supabase
    );

    // Verificar ownership
    const { data: method } = await supabase
      .from("client_payment_methods")
      .select("id, client_id")
      .eq("id", id)
      .eq("client_id", clientId)
      .single();

    if (!method) return NextResponse.json({ error: "Payment method not found" }, { status: 404 });

    // Si se setea como default, desmarcar el default anterior
    if (is_default) {
      await supabase
        .from("client_payment_methods")
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq("client_id", clientId)
        .eq("is_default", true);
    }

    const { error } = await supabase
      .from("client_payment_methods")
      .update({ is_default, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("payment-methods PATCH error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ updated: true }, { status: 200 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

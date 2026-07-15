import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { computeRebookDateOptions } from "@/lib/rebook";
import { getVancouverTodayString } from "@/lib/date-utils";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
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
  });
}

/**
 * GET /api/client/orders/[orderId]/rebook — v8.3 E5.12
 *
 * "Reagendar desde galería (3 toques)": toque 1 es el botón que dispara este
 * GET; devuelve las fechas rápidas (toque 2 elige una) y el prefill de la
 * cotización original para que el cliente confirme (toque 3) contra
 * POST /api/quote -- el único camino que recalcula precio en servidor. No
 * se reimplementa el motor de precios aquí (ver comentario en src/lib/rebook.ts).
 */
export async function GET(request: NextRequest, { params }: { params: { orderId: string } }) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, user_id, status, quote_id")
    .eq("id", params.orderId)
    .maybeSingle();

  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });
  if (!order || order.user_id !== user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "completed") {
    return NextResponse.json(
      { error: "Rebooking is only available for completed services" },
      { status: 409 }
    );
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "service_category, service_subtype, service_type, bedrooms, bathrooms, square_feet, pets_count, pets_type, residents, days_since_cleaning, address, zone, postal_code, consent_tc, consent_pipa, consent_marketing, consent_photo_marketing"
    )
    .eq("id", order.quote_id)
    .maybeSingle();

  if (quoteError) return NextResponse.json({ error: quoteError.message }, { status: 500 });
  if (!quote) {
    return NextResponse.json({ error: "Original quote not found" }, { status: 404 });
  }

  const prefill = {
    serviceCategory: quote.service_category,
    serviceSubtype: quote.service_subtype,
    serviceType: quote.service_type,
    bedrooms: quote.bedrooms,
    bathrooms: quote.bathrooms,
    squareFeet: quote.square_feet,
    petsCount: quote.pets_count,
    petsType: quote.pets_type,
    residents: quote.residents,
    daysSinceCleaning: 0, // se acaba de limpiar (este mismo servicio) -- recencia real, no la original
    address: quote.address,
    zone: quote.zone,
    postalCode: quote.postal_code,
    // El cliente ya aceptó T&C/PIPA en la reserva original; se reafirman aquí
    // (siguen siendo obligatorios en /api/quote, no se omiten).
    consentTc: quote.consent_tc ?? true,
    consentPipa: quote.consent_pipa ?? false,
    consentMarketing: quote.consent_marketing ?? false,
    consentPhotoMarketing: quote.consent_photo_marketing ?? undefined,
  };

  const suggestedDates = computeRebookDateOptions(getVancouverTodayString());

  return NextResponse.json(
    { prefill, suggestedDates, rebookedFromOrderId: order.id },
    { status: 200 }
  );
}

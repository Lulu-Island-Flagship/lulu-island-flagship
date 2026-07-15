import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { computeNextRecurringDate, type ContractFrequency } from "@/lib/rebook";
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
 * GET /api/client/contracts/next-visit — v8.3 E5.12 "recurrente de un toque".
 *
 * Devuelve, si el cliente tiene un contrato recurrente activo, el prefill de
 * cotización (mismos inputs crudos del contrato) + la próxima fecha
 * calculada. El botón del cliente hace UN toque: este GET + un POST
 * inmediato a /api/quote + redirect a /reserva/[quoteId], todo encadenado
 * sin más interacción. No se reimplementa el motor de precios aquí.
 */
export async function GET(_request: NextRequest) {
  const supabase = getSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: contract, error: contractError } = await supabase
    .from("service_contracts")
    .select("id, quote_id, frequency, next_scheduled_date, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contractError) return NextResponse.json({ error: contractError.message }, { status: 500 });
  if (!contract) {
    return NextResponse.json({ hasActiveContract: false }, { status: 200 });
  }

  if (!contract.quote_id) {
    return NextResponse.json(
      { hasActiveContract: true, error: "Contract has no source quote on file" },
      { status: 409 }
    );
  }

  const { data: quote, error: quoteError } = await supabase
    .from("quotes")
    .select(
      "service_category, service_subtype, service_type, bedrooms, bathrooms, square_feet, pets_count, pets_type, residents, address, zone, postal_code, consent_tc, consent_pipa, consent_marketing, consent_photo_marketing"
    )
    .eq("id", contract.quote_id)
    .maybeSingle();

  if (quoteError) return NextResponse.json({ error: quoteError.message }, { status: 500 });
  if (!quote) {
    return NextResponse.json(
      { hasActiveContract: true, error: "Original contract quote not found" },
      { status: 404 }
    );
  }

  const nextDate = computeNextRecurringDate(
    contract.next_scheduled_date as string | null,
    getVancouverTodayString(),
    contract.frequency as ContractFrequency
  );

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
    daysSinceCleaning: 0,
    address: quote.address,
    zone: quote.zone,
    postalCode: quote.postal_code,
    consentTc: quote.consent_tc ?? true,
    consentPipa: quote.consent_pipa ?? false,
    consentMarketing: quote.consent_marketing ?? false,
    consentPhotoMarketing: quote.consent_photo_marketing ?? undefined,
  };

  return NextResponse.json(
    { hasActiveContract: true, contractId: contract.id, prefill, nextDate },
    { status: 200 }
  );
}

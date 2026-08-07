
import { NextRequest, NextResponse } from "next/server";
import { computeNextRecurringDate, type ContractFrequency } from "@/lib/rebook";
import { getVancouverTodayString } from "@/lib/date-utils";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { requireClientCaller } from "@/lib/require-client-caller";
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
  const supabase = createRouteSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientGuard = await requireClientCaller(supabase, user.id);
  if (!clientGuard.ok) {
    return NextResponse.json({ error: clientGuard.error }, { status: clientGuard.status });
  }

  const { data: contract, error: contractError } = await supabase
    .from("service_contracts")
    .select("id, quote_id, frequency, next_scheduled_date, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (contractError) {

    console.error("contractError:", contractError);

    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });

  }
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

  if (quoteError) {

    console.error("quoteError:", quoteError);

    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });

  }
  if (!quote) {
    return NextResponse.json(
      { hasActiveContract: true, error: "Original contract quote not found" },
      { status: 404 }
    );
  }

  // v8.3 auditoría 2026-07-21 (E-B3): el generador de instancias de
  // contrato recurrente no existe en el repo -- ninguna ruta hace
  // .insert() sobre service_contracts ni escribe next_scheduled_date
  // (solo se lee). Este endpoint no puede arreglar eso (está fuera de
  // los archivos permitidos de este cambio); lo que sí puede hacer es no
  // esconder el problema: si next_scheduled_date es NULL o ya quedó en
  // el pasado (contrato "vivo" pero nunca avanzado por el cron/job que
  // debería re-agendarlo), se lo dice al cliente explícitamente en vez
  // de ofrecer una fecha calculada que parece confiable pero no lo es.
  const today = getVancouverTodayString();
  const rawNextScheduledDate = contract.next_scheduled_date as string | null;
  const nextScheduledDateIsMissing = !rawNextScheduledDate;
  const nextScheduledDateIsPast = !!rawNextScheduledDate && rawNextScheduledDate < today;

  const nextDate = computeNextRecurringDate(
    rawNextScheduledDate,
    today,
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
    {
      hasActiveContract: true,
      contractId: contract.id,
      prefill,
      nextDate,
      nextScheduledDateIsMissing,
      nextScheduledDateIsPast,
      staleScheduleWarning:
        nextScheduledDateIsMissing || nextScheduledDateIsPast
          ? "Este contrato no tiene una próxima fecha agendada vigente (next_scheduled_date ausente o en el pasado). 'nextDate' es una estimación calculada al vuelo, no una cita confirmada -- verifica con el cliente antes de asumir que la próxima visita ya está agendada."
          : null,
    },
    { status: 200 }
  );
}

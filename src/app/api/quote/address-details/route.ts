import { NextRequest, NextResponse } from "next/server";
import { getPlaceAddressDetails } from "@/lib/google-places";

/**
 * POST /api/quote/address-details { placeId } — dirección formateada +
 * código postal + localidad de una sugerencia de address-autocomplete/route.ts
 * ya seleccionada por el cliente. Ver comentario en google-places.ts:
 * nunca asigna la zona automáticamente -- StepAddress.tsx decide si hay un
 * match razonable contra ACTIVE_ZONES, y el cliente siempre puede corregir
 * cualquier campo después.
 */
export async function POST(request: NextRequest) {
  let placeId: unknown;
  try {
    const body = await request.json();
    placeId = body?.placeId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof placeId !== "string" || placeId.trim().length === 0) {
    return NextResponse.json({ error: "placeId is required" }, { status: 400 });
  }

  const result = await getPlaceAddressDetails(placeId.trim());
  return NextResponse.json(result, { status: 200 });
}

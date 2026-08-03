import { NextRequest, NextResponse } from "next/server";
import { autocompleteAddress } from "@/lib/google-places";

/**
 * POST /api/quote/address-autocomplete { input } — sugerencias de dirección
 * mientras el cliente escribe en StepAddress.tsx (paso de dirección del
 * cotizador). Reduce fricción de tecleo; nunca decide la zona ni el código
 * postal por sí sola -- eso lo hace address-details tras seleccionar una
 * sugerencia, y siempre queda editable por el cliente.
 *
 * autocompleteAddress() (src/lib/google-places.ts) ya maneja honestamente
 * el caso "sin GOOGLE_PLACES_API_KEY configurada" (available: false) -- esta
 * ruta solo lo expone al cotizador. La UI debe tratar available:false como
 * "sin autocompletado, seguir permitiendo escritura manual normal", nunca
 * como un error visible para el cliente.
 *
 * POST (no GET con query param) por el mismo motivo que bc-assessment/route.ts:
 * evita que la dirección parcial quede en logs de acceso del servidor/proxy.
 */
export async function POST(request: NextRequest) {
  let input: unknown;
  try {
    const body = await request.json();
    input = body?.input;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof input !== "string") {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const result = await autocompleteAddress(input);
  return NextResponse.json(result, { status: 200 });
}

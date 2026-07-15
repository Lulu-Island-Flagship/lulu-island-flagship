import { NextRequest, NextResponse } from "next/server";
import { lookupBcAssessment } from "@/lib/bc-assessment";

/**
 * GET /api/quote/bc-assessment?address=... — sugerencia DÉBIL de ft² desde
 * BC Assessment (E1.2 del spec: "Registro público sugiere ~1,200 ft².
 * Confírmalo: [Correcto] [No, es ___]" — nunca como hecho).
 *
 * lookupBcAssessment() (src/lib/bc-assessment.ts) ya maneja honestamente el
 * caso "sin proveedor configurado" (confidence: 'unavailable') -- esta ruta
 * solo la expone al cotizador, que hasta ahora nunca la llamaba.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!address || address.trim().length === 0) {
    return NextResponse.json({ error: "address query param is required" }, { status: 400 });
  }

  const result = await lookupBcAssessment(address.trim());
  return NextResponse.json(result, { status: 200 });
}

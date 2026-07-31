import { NextRequest, NextResponse } from "next/server";
import { lookupBcAssessment } from "@/lib/bc-assessment";

/**
 * POST /api/quote/bc-assessment { address } — sugerencia DÉBIL de ft² desde
 * BC Assessment (E1.2 del spec: "Registro público sugiere ~1,200 ft².
 * Confírmalo: [Correcto] [No, es ___]" — nunca como hecho).
 *
 * lookupBcAssessment() (src/lib/bc-assessment.ts) ya maneja honestamente el
 * caso "sin proveedor configurado" (confidence: 'unavailable') -- esta ruta
 * solo la expone al cotizador.
 *
 * Fix (auditoría UX/seguridad): antes era GET con la dirección como query
 * param (?address=...), quedando expuesta en logs de acceso del servidor y
 * de cualquier proxy/CDN intermedio. Se cambió a POST con body JSON -- no
 * dependía de cache HTTP por URL (la ruta lee de request.nextUrl y ya se
 * trataba como dinámica), así que no se pierde ningún beneficio de cache
 * existente.
 */
export async function POST(request: NextRequest) {
  let address: unknown;
  try {
    const body = await request.json();
    address = body?.address;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof address !== "string" || address.trim().length === 0) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const result = await lookupBcAssessment(address.trim());
  return NextResponse.json(result, { status: 200 });
}

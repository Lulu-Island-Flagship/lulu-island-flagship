import { NextResponse } from "next/server";
import { isPublicInsuredClaimReady } from "@/lib/business-insurance";

/**
 * GET /api/public/insured-status — v8.3 P0-4 fix (auditoría Fable5).
 *
 * Endpoint público, sin auth, de solo lectura. Existe únicamente para que
 * la copia VISIBLE del sitio (src/app/[locale]/page.tsx, componente
 * cliente) sepa si puede mostrar el claim "insured/asegurados" (B.4,
 * B.2.25). Nunca expone datos de las pólizas (proveedor, número, montos) --
 * solo un booleano fail-closed calculado server-side con el service role.
 *
 * El JSON-LD estático de page.tsx ya no afirma "insured" en absoluto (ver
 * comentario en ese archivo), así que este endpoint solo condiciona el
 * bloque "trust" visible y el hero/meta description.
 */
export async function GET() {
  const insuredClaimReady = await isPublicInsuredClaimReady();
  return NextResponse.json(
    { insuredClaimReady },
    { status: 200, headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } }
  );
}

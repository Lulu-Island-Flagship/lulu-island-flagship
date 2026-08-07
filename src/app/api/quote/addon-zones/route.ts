
import { NextRequest, NextResponse } from "next/server";
import { fetchAddonZoneOptions } from "@/lib/addon-zones";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

// Fix (auditoría externa, hallazgo A12): esta ruta lee `request.url`
// (request-time) -- sin esto Next intentaba pre-renderizarla en build,
// generando warnings y riesgo de caché incorrecta.
export const dynamic = "force-dynamic";
/**
 * GET /api/quote/addon-zones?serviceSubtype=...
 *
 * v8.3 E4 (D.7): zonas add-on (ej. Garaje) que el admin agregó y marcó para
 * ofrecer en el cotizador. Público (no requiere auth) porque el cotizador
 * es fricción cero — se llama antes de que el cliente inicie sesión.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceSubtype = searchParams.get("serviceSubtype");

    if (!serviceSubtype) {
      return NextResponse.json({ error: "Missing serviceSubtype" }, { status: 400 });
    }

    const supabase = createRouteSupabaseClient();
    const zones = await fetchAddonZoneOptions(supabase, serviceSubtype);

    return NextResponse.json({ zones }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

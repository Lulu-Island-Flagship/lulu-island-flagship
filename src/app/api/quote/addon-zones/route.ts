import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { fetchAddonZoneOptions } from "@/lib/addon-zones";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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

    const supabase = getSupabaseClient();
    const zones = await fetchAddonZoneOptions(supabase, serviceSubtype);

    return NextResponse.json({ zones }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

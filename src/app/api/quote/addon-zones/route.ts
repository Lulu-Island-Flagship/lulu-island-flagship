import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { fetchAddonZoneOptions } from "@/lib/addon-zones";

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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

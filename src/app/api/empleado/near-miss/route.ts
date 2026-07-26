import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";

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

const VALID_CATEGORIES = ["near_fall", "near_chemical_mix", "near_bite", "near_burn", "other"];

// POST /api/empleado/near-miss — reportar un casi-accidente, SIN penalización.
// v8.3 E7 (D.7.8): anonimato opcional. Si is_anonymous=true, igual guardamos
// reported_by para trazabilidad interna, pero la respuesta y los reportes
// agregados nunca lo exponen.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, description, isAnonymous, orderId, clientPropertyId } = body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `category invalida. Debe ser una de: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    const { data, error } = await supabase
      .from("near_misses")
      .insert({
        category,
        description: description || null,
        is_anonymous: isAnonymous === true,
        reported_by: employee.id,
        order_id: orderId || null,
        client_property_id: clientPropertyId || null,
      })
      .select("id, category, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ nearMiss: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

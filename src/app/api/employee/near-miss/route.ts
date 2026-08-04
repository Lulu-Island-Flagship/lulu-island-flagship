import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
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
        cookieStore.set({ name, value, ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: "", ...options, httpOnly: true, secure: true, sameSite: "lax" });
      },
    },
  });
}

const VALID_CATEGORIES = ["near_fall", "near_chemical_mix", "near_bite", "near_burn", "other"];

// POST /api/employee/near-miss — reportar un casi-accidente, SIN penalización.
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

    // v8.3 IDOR fix: verify employee is assigned to orderId before allowing the near-miss to be linked
    if (orderId) {
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("id")
        .eq("order_id", orderId)
        .eq("employee_id", employee.id)
        .maybeSingle();

      if (assignmentError) {
        console.error("assignmentError:", assignmentError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      if (!assignment) {
        return NextResponse.json({ error: "You are not assigned to this order" }, { status: 403 });
      }
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
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ nearMiss: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

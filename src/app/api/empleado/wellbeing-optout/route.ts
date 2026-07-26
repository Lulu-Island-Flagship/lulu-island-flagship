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

// v8.3 E8 FIX-2 — Opt-out de bienestar. El empleado controla su propia fila
// (misma política "Employees update own profile" de employees, migración
// 003/181) -- ningún admin puede tocar esta columna en nombre de alguien.

// GET /api/empleado/wellbeing-optout — estado actual
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
    id: string;
    wellbeing_opt_out: boolean | null;
  }>(supabase, user.id, "id, wellbeing_opt_out");

  if (!employee) {
    return NextResponse.json({ error: empError }, { status: empStatus });
  }

  return NextResponse.json({ wellbeingOptOut: employee.wellbeing_opt_out === true }, { status: 200 });
}

// PATCH /api/empleado/wellbeing-optout — { optOut: boolean }
export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fix auditoría implacable (2026-07-26, #4 de 3 APIs sin ningún check de
  // empleado): este PATCH actualizaba employees.wellbeing_opt_out
  // directamente por user_id, sin verificar primero que la fila
  // correspondiera a un empleado activo/no dado de baja -- un empleado
  // offboarded con sesión viva podía seguir escribiendo en su propia fila.
  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) {
    return NextResponse.json({ error: empError }, { status: empStatus });
  }

  try {
    const body = await request.json();
    if (typeof body.optOut !== "boolean") {
      return NextResponse.json({ error: "optOut (boolean) is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("employees")
      .update({ wellbeing_opt_out: body.optOut })
      .eq("id", employee.id)
      .select("wellbeing_opt_out")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Employee profile not found" }, { status: 403 });
    }

    return NextResponse.json({ wellbeingOptOut: data.wellbeing_opt_out === true }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

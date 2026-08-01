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

const VALID_COLORS = ["red", "blue", "green", "yellow", "white", "black"];
const VALID_STAGES = ["clean", "in_use", "dirty", "washing", "warehouse", "vehicle"];

// GET /api/empleado/panos — ultimo conteo registrado por color+etapa (hoy)
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fix auditoría implacable (2026-07-26, #4 de 3 APIs sin ningún check de
  // empleado): este GET leía towel_cycle_log de hoy con SOLO getUser() --
  // ni siquiera verificaba que el llamador fuera un empleado activo.
  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("towel_cycle_log")
    .select("id, color, stage, count, vehicle_id, recorded_at")
    .gte("recorded_at", today)
    .order("recorded_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data || [] }, { status: 200 });
}

// POST /api/empleado/panos — v8.3 D.7.3: conteo simple por COLOR, nunca por unidad.
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const { color, stage, count, vehicleId } = body;

    if (!VALID_COLORS.includes(color)) {
      return NextResponse.json({ error: `color inválido. Debe ser uno de: ${VALID_COLORS.join(", ")}` }, { status: 400 });
    }
    if (!VALID_STAGES.includes(stage)) {
      return NextResponse.json({ error: `stage inválido. Debe ser uno de: ${VALID_STAGES.join(", ")}` }, { status: 400 });
    }
    // Fix (auditoría 2026-07-31, #16): antes no había tope superior --
    // servía cualquier número positivo, incluidos valores absurdos por
    // typo. El límite de 999 es el mismo que ahora aplica el input
    // client-side (min/max), reforzado server-side.
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0 || count > 999) {
      return NextResponse.json({ error: "count debe ser un número entre 0 y 999" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("towel_cycle_log")
      .insert({
        color,
        stage,
        count,
        vehicle_id: vehicleId || null,
        recorded_by: employee.id,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ log: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

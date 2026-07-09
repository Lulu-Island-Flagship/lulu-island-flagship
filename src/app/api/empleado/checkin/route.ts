import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

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

// GET /api/empleado/checkin — mi checkin de hoy (si ya lo hice)
export async function GET() {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("daily_checkins")
    .select("checkin_date, slept_6h_plus, mood, shortcut_accepted")
    .eq("employee_id", employee.id)
    .eq("checkin_date", today)
    .single();

  return NextResponse.json({ checkin: data || null }, { status: 200 });
}

// POST /api/empleado/checkin — checklist matutino (opcional, incentivado).
// v8.3 E8: NUNCA se lee individualmente por el admin — solo vía agregado.
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  try {
    const body = await request.json();
    const { slept6hPlus, mood, shortcutAccepted } = body;

    if (mood && !["happy", "neutral", "sad"].includes(mood)) {
      return NextResponse.json({ error: "mood inválido" }, { status: 400 });
    }

    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("daily_checkins")
      .upsert(
        {
          employee_id: employee.id,
          checkin_date: today,
          slept_6h_plus: slept6hPlus ?? null,
          mood: mood ?? null,
          shortcut_accepted: shortcutAccepted === true,
        },
        { onConflict: "employee_id,checkin_date" }
      )
      .select("checkin_date, slept_6h_plus, mood, shortcut_accepted")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ checkin: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

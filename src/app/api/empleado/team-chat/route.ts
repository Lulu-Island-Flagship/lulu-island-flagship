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

const MAX_MESSAGE_LENGTH = 160;
const HISTORY_DAYS = 7;

/**
 * v8.3 E8.12 — Chat interno del equipo del día. Solo texto, 160 caracteres,
 * historial 7 días, activo solo en jornada (mientras la orden no esté
 * completada/cancelada/no-show). No hay -- y nunca debe haber -- detección
 * de contenido de mensajes (B.2.22: prohibido vigilar/sancionar discusión
 * de salarios).
 *
 * GET  /api/empleado/team-chat?orderId=... — últimos 7 días de mensajes.
 * POST /api/empleado/team-chat — { orderId, body }
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orderId = request.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "orderId es obligatorio" }, { status: 400 });
  }

  const sinceIso = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("team_chat_messages")
    .select("id, body, created_at, sender_employee_id, employees:sender_employee_id ( name )")
    .eq("order_id", orderId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = (data || []).map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    senderName: (m.employees as unknown as { name: string } | null)?.name ?? "Compañero",
  }));

  return NextResponse.json({ messages }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: employee } = await supabase.from("employees").select("id").eq("user_id", user.id).single();
  if (!employee) return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });

  try {
    const { orderId, body } = await request.json();

    if (!orderId) {
      return NextResponse.json({ error: "orderId es obligatorio" }, { status: 400 });
    }
    if (typeof body !== "string" || body.trim().length === 0) {
      return NextResponse.json({ error: "body es obligatorio" }, { status: 400 });
    }
    if (body.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Máximo ${MAX_MESSAGE_LENGTH} caracteres` }, { status: 400 });
    }

    // "activo solo en jornada": la orden de hoy no debe estar ya cerrada.
    const { data: assignment } = await supabase
      .from("assignments")
      .select("id, status, order_id")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (!assignment) {
      return NextResponse.json({ error: "No tienes una asignación en esta orden" }, { status: 403 });
    }
    if (["completed", "cancelled", "no_show"].includes(assignment.status)) {
      return NextResponse.json({ error: "El chat está cerrado: la jornada de esta orden ya terminó" }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("team_chat_messages")
      .insert({ order_id: orderId, sender_employee_id: employee.id, body: body.trim() })
      .select("id, body, created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

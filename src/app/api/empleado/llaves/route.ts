import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { validateKeyLog, type KeyMethod } from "@/lib/key-handling";
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

// GET /api/empleado/llaves?orderId=... — historial de manejo de llaves de una orden
export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ error: "orderId requerido" }, { status: 400 });

  // v8.3 fix C-H4 (auditoría RBAC 2026-07-21): este GET expone
  // lockbox_code -- el código de acceso físico a la vivienda del cliente.
  // Antes no comprobaba que el empleado estuviera asignado a la orden (solo
  // "salvado por accidente" por una policy RLS de supervisores que no cubre
  // a un empleado raso). Mismo patrón de verificación de assignments que
  // /api/empleado/upsells/route.ts.
  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const { data: assignment, error: assignError } = await supabase
    .from("assignments")
    .select("id")
    .is("deleted_at", null)
    .eq("order_id", orderId)
    .eq("employee_id", employee.id)
    .single();

  if (assignError || !assignment) {
    return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("key_handling_log")
    .select("id, method, lockbox_code, confirmed_returned, signature_url, closing_photo_url, escalated_at, escalation_resolved_as, created_at")
    .eq("order_id", orderId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data || [] }, { status: 200 });
}

// POST /api/empleado/llaves — registrar manejo de llaves (v8.3 D.7.5)
export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  try {
    const body = await request.json();
    const { orderId, method, lockboxCode, confirmedReturned, signatureUrl, closingPhotoUrl } = body as {
      orderId: string; method: KeyMethod; lockboxCode?: string; confirmedReturned?: boolean;
      signatureUrl?: string; closingPhotoUrl?: string;
    };

    if (!orderId || !method) {
      return NextResponse.json({ error: "orderId y method son requeridos" }, { status: 400 });
    }

    // v8.3 fix C-H4: sin esto, cualquier empleado autenticado podía
    // insertar un registro de manejo de llaves (incluido lockbox_code) para
    // una orden ajena -- explotable hoy, sin protección RLS de por medio en
    // el INSERT. Mismo patrón que /api/empleado/upsells/route.ts.
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // "problem" no exige campos (se resuelve por escalacion), el resto si.
    const missing = validateKeyLog(method, { lockboxCode, confirmedReturned, signatureUrl, closingPhotoUrl });
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Faltan campos requeridos para el método '${method}': ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("key_handling_log")
      .insert({
        order_id: orderId,
        method,
        lockbox_code: lockboxCode || null,
        confirmed_returned: confirmedReturned === true,
        signature_url: signatureUrl || null,
        closing_photo_url: closingPhotoUrl || null,
        escalated_at: method === "problem" ? new Date().toISOString() : null,
        escalation_resolved_as: method === "problem" ? "pending" : null,
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

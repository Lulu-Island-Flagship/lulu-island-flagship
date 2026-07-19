import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isValidConfirmation, detectHazard, type ChemicalConfirmationAttempt } from "@/lib/chemical-lockout";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
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
    }
  );
}

/**
 * v8.3 E4 fix (auditoría 2026-07-18) — Poka-yoke químico sin enforcement
 * server-side. Antes, ChemicalMatchModal.tsx validaba
 * color+ícono+texto SOLO en el cliente (chemical-lockout.ts) y guardaba el
 * resultado en un useState del padre (ServicioPage) — se perdía al
 * refrescar, y un empleado podía saltarse el modal por completo llamando
 * directo a POST /api/empleado/checklist con isCompleted=true. Este
 * endpoint es la fuente de verdad real: persiste la confirmación en
 * chemical_zone_confirmations (migración 185) SOLO si la validación de las
 * 3 señales (color+ícono+texto) pasa server-side, reusando las mismas
 * funciones puras que el cliente. POST /api/empleado/checklist consulta
 * esta tabla antes de aceptar is_completed=true en zonas de riesgo químico.
 */

// GET /api/empleado/chemical-confirm?orderId=... — colores ya confirmados
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    const { data: rows, error: rowsError } = await supabase
      .from("chemical_zone_confirmations")
      .select("zone_color")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id);

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 });
    }

    return NextResponse.json(
      { confirmedColors: (rows || []).map((r) => r.zone_color) },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/empleado/chemical-confirm — intenta confirmar el producto de una zona
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, targetColor, selectedColor, selectedIcon, selectedText } = body;

    if (!orderId || !targetColor || !selectedColor || !selectedIcon || !selectedText) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Verificar que el empleado tiene asignación para este order (mismo
    // candado de ownership que checklist/servicio).
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

    const attempt: ChemicalConfirmationAttempt = { targetColor, selectedColor, selectedIcon, selectedText };
    if (!isValidConfirmation(attempt)) {
      return NextResponse.json(
        { ok: false, error: "La confirmación no coincide con color, ícono y texto del producto." },
        { status: 400 }
      );
    }

    // Poka-yoke de mezcla peligrosa (D.5): re-chequea contra lo YA
    // confirmado hoy para esta orden por este empleado, server-side —
    // nunca confía solo en el set en memoria del cliente.
    const { data: existingRows } = await supabase
      .from("chemical_zone_confirmations")
      .select("zone_color")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id);
    const activeColors = new Set<string>((existingRows || []).map((r) => r.zone_color));

    const hazardCheck = detectHazard(selectedColor, activeColors);
    if (hazardCheck.hazard) {
      return NextResponse.json(
        {
          ok: false,
          hazard: true,
          conflictingColor: hazardCheck.conflictingColor,
          error: "RIESGO DE GAS CLORO: este producto es incompatible con uno ya confirmado hoy.",
        },
        { status: 409 }
      );
    }

    const { error: upsertError } = await supabase
      .from("chemical_zone_confirmations")
      .upsert(
        { order_id: orderId, employee_id: employee.id, zone_color: targetColor, confirmed_at: new Date().toISOString() },
        { onConflict: "order_id,employee_id,zone_color" }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    activeColors.add(targetColor);
    return NextResponse.json({ ok: true, confirmedColors: Array.from(activeColors) }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

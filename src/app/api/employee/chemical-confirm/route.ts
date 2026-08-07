
import { NextRequest, NextResponse } from "next/server";
import { isValidConfirmation, detectHazard, type ChemicalConfirmationAttempt } from "@/lib/chemical-lockout";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
/**
 * v8.3 E4 fix (auditoría 2026-07-18) — Poka-yoke químico sin enforcement
 * server-side. Antes, ChemicalMatchModal.tsx validaba
 * color+ícono+texto SOLO en el cliente (chemical-lockout.ts) y guardaba el
 * resultado en un useState del padre (ServicioPage) — se perdía al
 * refrescar, y un empleado podía saltarse el modal por completo llamando
 * directo a POST /api/employee/checklist con isCompleted=true. Este
 * endpoint es la fuente de verdad real: persiste la confirmación en
 * chemical_zone_confirmations (migración 185) SOLO si la validación de las
 * 3 señales (color+ícono+texto) pasa server-side, reusando las mismas
 * funciones puras que el cliente. POST /api/employee/checklist consulta
 * esta tabla antes de aceptar is_completed=true en zonas de riesgo químico.
 */

// GET /api/employee/chemical-confirm?orderId=... — colores ya confirmados
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Fix auditoría implacable (2026-07-26, paso 5): este GET nunca
    // verificaba que el empleado tuviera asignación real sobre `orderId`
    // -- mismo candado de ownership que ya usa el POST de este archivo.
    const { data: chemAssignment, error: chemAssignError } = await supabase
      .from("assignments")
      .select("id")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();
    if (chemAssignError || !chemAssignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    const { data: rows, error: rowsError } = await supabase
      .from("chemical_zone_confirmations")
      .select("zone_color")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id);

    if (rowsError) {
      console.error("rowsError:", rowsError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json(
      { confirmedColors: (rows || []).map((r) => r.zone_color) },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// POST /api/employee/chemical-confirm — intenta confirmar el producto de una zona
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, targetColor, selectedColor, selectedIcon, selectedText } = body;

    if (!orderId || !targetColor || !selectedColor || !selectedIcon || !selectedText) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
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
      console.error("upsertError:", upsertError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    activeColors.add(targetColor);
    return NextResponse.json({ ok: true, confirmedColors: Array.from(activeColors) }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

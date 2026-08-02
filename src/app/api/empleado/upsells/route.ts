import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";
import { isValidUuid } from "@/lib/validation";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
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
    }
  );
}

// GET /api/empleado/upsells?orderId=...
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }
    if (!isValidUuid(orderId)) {
      return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
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

    const { data: upsells, error } = await supabase
      .from("service_upsells")
      .select("*")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ upsells: upsells || [] }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// POST /api/empleado/upsells
// Registra un upsell propuesto (solo informativo, no afecta cobro Stripe)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, upsellType, upsellLabel, amount, notes } = body;

    if (!orderId || !upsellType || !upsellLabel || amount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!isValidUuid(orderId)) {
      return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
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

    // Verificar que el empleado tiene asignación para este order
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

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }

    // v8.3 FIX-6 (B.5): "tope: upsell ≤50% del valor base sin aprobación
    // admin". Antes de este cambio nada verificaba esto -- cualquier monto
    // se insertaba y el líder podía comisionar sobre un upsell arbitrariamente
    // grande sin que un admin lo revisara. valor base = quotes.total de la
    // orden (el valor completo cotizado, no solo el subtotal antes de
    // impuestos). El tope es sobre el ACUMULADO de upsells ya registrados
    // para esta orden + el nuevo, no solo el monto individual -- de lo
    // contrario dos upsells de 30% cada uno evadirían el tope.
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, quote_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const { data: quote } = await supabase
      .from("quotes")
      .select("total")
      .eq("id", order.quote_id)
      .single();

    const baseValue = quote ? Number(quote.total) : 0;

    // v8.3 auditoría 2026-07-21 (E-A4): baseValue=0 (quote no encontrado o
    // total inválido) hacía que `requiresAdminApproval = baseValue > 0 &&
    // ...` fuera SIEMPRE false -- un upsell de cualquier monto pasaba
    // como auto-aprobado precisamente cuando no había forma de verificar
    // el tope del 50%. Se rechaza en vez de auto-aprobar a ciegas.
    if (!baseValue || baseValue <= 0) {
      return NextResponse.json(
        { error: "Cannot register an upsell: the order's source quote total could not be found." },
        { status: 400 }
      );
    }

    const { data: existingUpsells } = await supabase
      .from("service_upsells")
      .select("amount, approval_status")
      .eq("order_id", orderId)
      .neq("approval_status", "admin_rejected");

    const alreadyRegisteredTotal = (existingUpsells || []).reduce(
      (sum, u) => sum + (Number(u.amount) || 0),
      0
    );
    const cumulativeTotal = alreadyRegisteredTotal + amount;
    const cap = baseValue * 0.5;
    const requiresAdminApproval = baseValue > 0 && cumulativeTotal > cap;

    const { data: upsell, error } = await supabase
      .from("service_upsells")
      .insert({
        order_id: orderId,
        employee_id: employee.id,
        upsell_type: upsellType,
        upsell_label: upsellLabel,
        amount,
        notes: notes || null,
        requires_admin_approval: requiresAdminApproval,
        approval_status: requiresAdminApproval ? "pending_admin_approval" : "auto_approved",
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (requiresAdminApproval) {
      // Mismo patrón que las discrepancias de despacho (tickets_disputas,
      // migración 080): visible en la bandeja del admin sin inventar una
      // tabla paralela.
      await supabase.from("tickets_disputas").insert({
        order_id: orderId,
        type: "upsell_approval",
        priority: "medium",
        status: "open",
        context: {
          order_id: orderId,
          upsell_id: upsell.id,
          amount,
          cumulative_total: cumulativeTotal,
          base_value: baseValue,
          cap,
          source: "upsell_cap",
        },
      });
    }

    return NextResponse.json({ success: true, upsell, requiresAdminApproval }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

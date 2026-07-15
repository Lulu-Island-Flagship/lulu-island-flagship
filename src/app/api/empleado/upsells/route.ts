import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

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

// GET /api/empleado/upsells?orderId=...
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

    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 403 });
    }

    const { data: upsells, error } = await supabase
      .from("service_upsells")
      .select("*")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ upsells: upsells || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
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

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 403 });
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
      return NextResponse.json({ error: error.message }, { status: 500 });
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
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

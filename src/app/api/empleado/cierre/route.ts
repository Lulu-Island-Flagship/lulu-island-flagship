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

const VALID_EXTERNAL_TYPES = ["client_verbal", "leader_audit", "auditor_present"];
const VALID_ALT_PAYMENT_METHODS = ["e_transfer", "cheque", "cash"];

// GET /api/empleado/cierre?orderId=... — estado actual del cierre (para la UI)
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

    const { data: closure } = await supabase
      .from("service_closures")
      .select(
        "implementos_confirmed, external_confirmation_type, external_confirmation_notes, alt_payment_method, alt_payment_amount, alt_payment_signature_url, alt_payment_confirmed_at"
      )
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .is("deleted_at", null)
      .maybeSingle();

    return NextResponse.json({
      implementsConfirmed: closure?.implementos_confirmed || false,
      externalConfirmationType: closure?.external_confirmation_type || null,
      externalConfirmationNotes: closure?.external_confirmation_notes || null,
      altPaymentMethod: closure?.alt_payment_method || null,
      altPaymentAmount: closure?.alt_payment_amount ?? null,
      altPaymentSignatureUrl: closure?.alt_payment_signature_url || null,
      altPaymentConfirmedAt: closure?.alt_payment_confirmed_at || null,
    });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/empleado/cierre — confirma implementos y/o confirmación externa
// para el Protocolo de Cierre Externo (E4.11). No cierra el servicio por sí
// mismo — T_out (en /api/empleado/servicio) es el que evalúa el protocolo
// completo y solo entonces marca COMPLETADO.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      orderId,
      implementsConfirmed,
      externalConfirmationType,
      externalConfirmationNotes,
      altPaymentMethod,
      altPaymentAmount,
      altPaymentSignatureUrl,
    } = body;

    if (!orderId) {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }
    if (
      externalConfirmationType !== undefined &&
      externalConfirmationType !== null &&
      !VALID_EXTERNAL_TYPES.includes(externalConfirmationType)
    ) {
      return NextResponse.json(
        { error: `externalConfirmationType debe ser uno de: ${VALID_EXTERNAL_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    // v8.3 E6.6: pago alternativo (e-transfer/cheque/efectivo) para clientes
    // sin Stripe utilizable el día del servicio (típicamente el flujo
    // cliente-sin-smartphone). NO forma parte del Protocolo de Cierre
    // Externo de 5 requisitos (src/lib/closure-protocol.ts no cambia) --
    // es información operativa adicional para contabilidad (E9), nunca un
    // requisito para que T_out se acepte.
    if (
      altPaymentMethod !== undefined &&
      altPaymentMethod !== null &&
      !VALID_ALT_PAYMENT_METHODS.includes(altPaymentMethod)
    ) {
      return NextResponse.json(
        { error: `altPaymentMethod debe ser uno de: ${VALID_ALT_PAYMENT_METHODS.join(", ")}` },
        { status: 400 }
      );
    }
    if (
      altPaymentMethod &&
      (typeof altPaymentSignatureUrl !== "string" || altPaymentSignatureUrl.trim().length === 0)
    ) {
      return NextResponse.json(
        { error: "A signed receipt photo (altPaymentSignatureUrl) is required when registering an alternate payment method." },
        { status: 400 }
      );
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

    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from("service_closures")
      .select("id")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .is("deleted_at", null)
      .maybeSingle();

    const patch: Record<string, unknown> = { updated_at: now };
    if (implementsConfirmed !== undefined) {
      patch.implementos_confirmed = !!implementsConfirmed;
      patch.implementos_confirmed_at = implementsConfirmed ? now : null;
    }
    if (externalConfirmationType !== undefined) {
      patch.external_confirmation_type = externalConfirmationType || null;
      patch.external_confirmation_at = externalConfirmationType ? now : null;
      patch.external_confirmation_notes = externalConfirmationNotes || null;
    }
    if (altPaymentMethod !== undefined) {
      patch.alt_payment_method = altPaymentMethod || null;
      patch.alt_payment_amount = altPaymentMethod ? (altPaymentAmount ?? null) : null;
      patch.alt_payment_signature_url = altPaymentMethod ? (altPaymentSignatureUrl || null) : null;
      patch.alt_payment_confirmed_at = altPaymentMethod ? now : null;
    }

    let result;
    if (existing) {
      result = await supabase
        .from("service_closures")
        .update(patch)
        .eq("id", existing.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from("service_closures")
        .insert({
          order_id: orderId,
          employee_id: employee.id,
          ...patch,
        })
        .select()
        .single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, closure: result.data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

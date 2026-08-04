import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildServiceBriefing, type ServiceType } from "@/lib/service-briefing";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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
  });
}

/**
 * GET /api/employee/service/[orderId]/briefing — v8.3 E8.7: preparación
 * contextual por servicio (mismo dato que ya existe en quotes/
 * client_profiles, nunca antes ensamblado en tips accionables para el
 * líder). Solo lectura; el empleado debe tener una asignación en la orden.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const supabase = getSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);
  if (!employee) return NextResponse.json({ error: empError }, { status: empStatus });

  const { orderId } = await params;

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id")
    .eq("order_id", orderId)
    .eq("employee_id", employee.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!assignment) {
    return NextResponse.json({ error: "No tienes una asignación en esta orden" }, { status: 403 });
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, quote_id")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  const { data: quote } = await supabase
    .from("quotes")
    .select("service_type, pets_count, pets_type, user_id")
    .eq("id", order.quote_id)
    .maybeSingle();

  if (!quote) {
    return NextResponse.json({ error: "Cotización no encontrada para esta orden" }, { status: 404 });
  }

  const { data: clientProfile } = await supabase
    .from("client_profiles")
    .select("services_count, disputes_count")
    .eq("user_id", quote.user_id)
    .maybeSingle();

  const serviceType: ServiceType =
    quote.service_type === "move_in_out" || quote.service_type === "post_construction" || quote.service_type === "deep"
      ? quote.service_type
      : "regular";

  const tips = buildServiceBriefing({
    serviceType,
    petsCount: quote.pets_count ?? 0,
    petsType: quote.pets_type ?? "none",
    isNewClient: (clientProfile?.services_count ?? 0) === 0,
    hasDisputeHistory: (clientProfile?.disputes_count ?? 0) > 0,
  });

  return NextResponse.json({ tips }, { status: 200 });
}

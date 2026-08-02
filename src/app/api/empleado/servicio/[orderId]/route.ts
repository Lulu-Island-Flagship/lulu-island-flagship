import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

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

// GET /api/empleado/servicio/[orderId] — servicio específico asignado al empleado
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId } = await params;

    // Buscar perfil de empleado
    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Verificar asignación directa
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id, status, order_id, employee_id")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "Service not assigned to you" }, { status: 403 });
    }

    // Traer datos del servicio
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id,
        user_id,
        service_date,
        service_time,
        status,
        quote_id,
        address_lat,
        address_lng,
        quotes:quote_id (
          address,
          zone,
          service_type,
          service_subtype,
          square_feet,
          bedrooms,
          bathrooms,
          pets_count,
          pets_type,
          residents
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const quote = order.quotes as unknown as Record<string, unknown> | null;

    // v8.3 E6.6: el líder necesita saber si este cliente está en el flujo
    // "sin smartphone" para mostrar la sección de pago alternativo
    // (e-transfer/cheque/efectivo + recibo firmado) en el cierre.
    let noSmartphoneFlow = false;
    if (order.user_id) {
      const { data: clientProfile } = await supabase
        .from("client_profiles")
        .select("no_smartphone_flow")
        .eq("user_id", order.user_id)
        .maybeSingle();
      noSmartphoneFlow = !!clientProfile?.no_smartphone_flow;
    }

    // Fix auditoría 2026-07-30: este endpoint nunca devolvía datos de
    // contacto del cliente (clientName/clientPhone), aunque el frontend
    // (ContactInfoDisclosure en servicio/[orderId]/page.tsx) ya los lee de
    // service.clientName/service.clientPhone -- mismo patrón exacto que
    // /api/empleado/servicios/route.ts (join con `profiles`, no
    // `client_profiles`, que no tiene nombre/teléfono).
    let clientName = "";
    let clientPhone = "";
    if (order.user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", order.user_id)
        .maybeSingle();
      clientName = profile?.full_name || "";
      clientPhone = profile?.phone || "";
    }

    return NextResponse.json({
      service: {
        assignmentId: assignment.id,
        orderId: order.id,
        status: assignment.status,
        serviceDate: order.service_date,
        serviceTime: order.service_time,
        address: quote?.address || "",
        zone: quote?.zone || "",
        // v8.3 E4 fix (13 jul 2026): esto estaba leyendo quote.service_type
        // (el tipo interno de HHE: regular/deep/move_in_out/post_construction)
        // en un campo llamado serviceSubtype, que el checklist SOP necesita
        // como service_subtype real ("first_time"/"regular"/"move_in_out"/
        // "office"/"airbnb"/"post_construction"). Coincidían por casualidad
        // solo cuando subtype y type comparten el string ("regular"); para
        // "first_time" (mapsTo "deep") el checklist quedaba vacío en
        // producción. sop_checklists SIEMPRE se indexa por service_subtype.
        serviceSubtype: quote?.service_subtype || "",
        squareFeet: quote?.square_feet || 0,
        bedrooms: quote?.bedrooms || 0,
        bathrooms: quote?.bathrooms || 0,
        petsCount: quote?.pets_count || 0,
        petsType: quote?.pets_type || "",
        residents: quote?.residents || 0,
        addressLat: order.address_lat ?? undefined,
        addressLng: order.address_lng ?? undefined,
        noSmartphoneFlow,
        clientName,
        clientPhone,
      },
    }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

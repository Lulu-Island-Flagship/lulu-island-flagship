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
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 403 });
    }

    // Verificar asignación directa
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id, status, order_id, employee_id")
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

    return NextResponse.json({
      service: {
        assignmentId: assignment.id,
        orderId: order.id,
        status: assignment.status,
        serviceDate: order.service_date,
        serviceTime: order.service_time,
        address: quote?.address || "",
        zone: quote?.zone || "",
        serviceSubtype: quote?.service_type || "",
        squareFeet: quote?.square_feet || 0,
        bedrooms: quote?.bedrooms || 0,
        bathrooms: quote?.bathrooms || 0,
        petsCount: quote?.pets_count || 0,
        petsType: quote?.pets_type || "",
        residents: quote?.residents || 0,
        addressLat: order.address_lat ?? undefined,
        addressLng: order.address_lng ?? undefined,
      },
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

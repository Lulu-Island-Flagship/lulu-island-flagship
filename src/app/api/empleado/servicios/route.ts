import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

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

// GET /api/empleado/servicios — lista de servicios del día para el empleado autenticado
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar el perfil de empleado del usuario autenticado
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id, name, role")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Obtener fecha de hoy en formato ISO (YYYY-MM-DD)
    const today = new Date().toISOString().split("T")[0];

    // Buscar asignaciones del empleado para órdenes de hoy o futuras
    const { data: assignments, error: assignError } = await supabase
      .from("assignments")
      .select(`
        id,
        order_id,
        status,
        assigned_at,
        notes,
        orders:order_id (
          id,
          service_date,
          service_time,
          status,
          quotes:quote_id (
            id,
            service_subtype,
            address,
            zone,
            square_feet,
            bedrooms,
            bathrooms,
            pets_count,
            pets_type,
            residents,
            total,
            user_id
          )
        )
      `)
      .eq("employee_id", employee.id)
      .gte("orders.service_date", today)
      .order("orders(service_date)", { ascending: true })
      .order("orders(service_time)", { ascending: true });

    if (assignError) {
      console.error("Assignments fetch error:", assignError);
      return NextResponse.json({ error: assignError.message }, { status: 500 });
    }

    // Enriquecer con datos del cliente (nombre/email desde auth.users)
    const enriched = [];
    if (assignments) {
      for (const a of assignments) {
        const order = a.orders as unknown as Record<string, unknown> | null;
        const quote = order?.quotes as unknown as Record<string, unknown> | null;
        const clientUserId = quote?.user_id as string | undefined;

        let clientName = "";
        let clientPhone = "";
        if (clientUserId) {
          const { data: userData } = await supabase
            .from("profiles")
            .select("full_name, phone")
            .eq("id", clientUserId)
            .single();
          if (userData) {
            clientName = (userData.full_name as string) || "";
            clientPhone = (userData.phone as string) || "";
          }
        }

        enriched.push({
          assignmentId: a.id,
          orderId: a.order_id,
          status: a.status,
          assignedAt: a.assigned_at,
          notes: a.notes,
          serviceDate: order?.service_date,
          serviceTime: order?.service_time,
          orderStatus: order?.status,
          serviceSubtype: quote?.service_subtype,
          address: quote?.address,
          zone: quote?.zone,
          squareFeet: quote?.square_feet,
          bedrooms: quote?.bedrooms,
          bathrooms: quote?.bathrooms,
          petsCount: quote?.pets_count,
          petsType: quote?.pets_type,
          residents: quote?.residents,
          total: quote?.total,
          clientName,
          clientPhone,
        });
      }
    }

    return NextResponse.json(
      { services: enriched, employee: { id: employee.id, name: employee.name, role: employee.role } },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Employee services error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/vehicles — lista de vehículos
export async function GET() {
  const auth = await requireAdminRole("vehicles");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data, error } = await auth.supabase
      .from("vehicles")
      .select(
        "id, name, plate, is_active, current_lat, current_lng, last_location_at, insurance_expiry_date, registration_expiry_date, next_maintenance_due_date, created_at"
      )
      .order("name", { ascending: true });

    if (error) {
      console.error("Vehicles fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ vehicles: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

// POST /api/admin/vehicles — crear vehículo
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("vehicles", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { name, plate, isActive, insuranceExpiryDate } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("vehicles")
      .insert({
        name,
        plate: plate || null,
        is_active: isActive ?? true,
        insurance_expiry_date: insuranceExpiryDate || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Vehicle insert error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ vehicle: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

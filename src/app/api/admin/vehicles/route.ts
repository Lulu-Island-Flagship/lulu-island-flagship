import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";

// GET /api/admin/vehicles — lista de vehículos
export async function GET() {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data, error } = await auth.supabase
      .from("vehicles")
      .select("id, name, plate, is_active, current_lat, current_lng, last_location_at, created_at")
      .order("name", { ascending: true });

    if (error) {
      console.error("Vehicles fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ vehicles: data || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Vehicles API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/vehicles — crear vehículo
export async function POST(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { name, plate, isActive } = body;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("vehicles")
      .insert({
        name,
        plate: plate || null,
        is_active: isActive ?? true,
      })
      .select()
      .single();

    if (error) {
      console.error("Vehicle insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ vehicle: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

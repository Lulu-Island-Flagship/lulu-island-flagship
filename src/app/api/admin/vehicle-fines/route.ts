import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluateVehicleFineRisk } from "@/lib/property-risk";

/**
 * GET/POST /api/admin/vehicle-fines — v8.3 E7 fix de auditoría (migración
 * 186). Registro básico de multas vehiculares (tránsito/parking) recibidas
 * por un vehículo/conductor de la empresa. Reusa el recurso "vehicles" del
 * RBAC (mismo nivel que /api/admin/vehicles ya existente para
 * seguro/registro/mantenimiento, migración 047).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("vehicles", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const vehicleId = searchParams.get("vehicleId");

  let query = auth.supabase
    .from("vehicle_fines")
    .select(
      "id, vehicle_id, driver_employee_id, address, amount_cents, fine_date, notes, status, paid_at, created_at, vehicles(name, plate), employees(name)"
    )
    .is("deleted_at", null)
    .order("fine_date", { ascending: false });

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("admin/vehicle-fines error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const fines = data || [];
  const unpaidByVehicle = new Map<string, { count: number; totalCents: number }>();
  for (const f of fines as { vehicle_id: string; status: string; amount_cents: number }[]) {
    if (f.status !== "unpaid") continue;
    const existing = unpaidByVehicle.get(f.vehicle_id) || { count: 0, totalCents: 0 };
    existing.count += 1;
    existing.totalCents += f.amount_cents;
    unpaidByVehicle.set(f.vehicle_id, existing);
  }

  const riskByVehicle = Array.from(unpaidByVehicle.entries()).map(([vId, agg]) => ({
    vehicleId: vId,
    unpaidFinesCount: agg.count,
    unpaidFinesTotalCents: agg.totalCents,
    ...evaluateVehicleFineRisk({ unpaidFinesCount: agg.count, unpaidFinesTotalCents: agg.totalCents }),
  }));

  return NextResponse.json({ fines, riskByVehicle }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("vehicles", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { vehicleId, driverEmployeeId, address, amountDollars, fineDate, notes } = body;

    if (!vehicleId) {
      return NextResponse.json({ error: "vehicleId es requerido" }, { status: 400 });
    }
    if (typeof amountDollars !== "number" || amountDollars <= 0) {
      return NextResponse.json({ error: "amountDollars debe ser un número positivo" }, { status: 400 });
    }
    if (!fineDate || !/^\d{4}-\d{2}-\d{2}$/.test(fineDate)) {
      return NextResponse.json({ error: "fineDate debe ser una fecha YYYY-MM-DD" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("vehicle_fines")
      .insert({
        vehicle_id: vehicleId,
        driver_employee_id: driverEmployeeId || null,
        address: address ? String(address).trim() : null,
        amount_cents: Math.round(amountDollars * 100),
        fine_date: fineDate,
        notes: notes ? String(notes).trim() : null,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/vehicle-fines error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ fine: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

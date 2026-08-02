import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// PATCH /api/admin/vehicles/[id] — actualizar seguro/registro/mantenimiento de un vehículo.
// v8.3 E7: el bloqueo REAL de asignación con seguro vencido vive en el trigger
// SQL prevent_expired_vehicle_assignment (migración 047). Esta ruta solo
// administra el dato; no duplica la validación de bloqueo.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("vehicles", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const {
      name,
      plate,
      isActive,
      insuranceExpiryDate,
      registrationExpiryDate,
      nextMaintenanceDueDate,
    } = body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (plate !== undefined) updates.plate = plate || null;
    if (isActive !== undefined) updates.is_active = isActive;
    if (insuranceExpiryDate !== undefined) updates.insurance_expiry_date = insuranceExpiryDate || null;
    if (registrationExpiryDate !== undefined) updates.registration_expiry_date = registrationExpiryDate || null;
    if (nextMaintenanceDueDate !== undefined) updates.next_maintenance_due_date = nextMaintenanceDueDate || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await auth.supabase
      .from("vehicles")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      console.error("Vehicle update error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ vehicle: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

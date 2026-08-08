import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/equipment-reservations — listar reservas de implementos caros
// (v8.3 E7 punto 3: "Punto logístico ... implementos caros (vaporizador, HEPA)
// reservables por equipo/día"). Filtro opcional de rango: ?from=YYYY-MM-DD&to=YYYY-MM-DD.
// Paginado con .limit(50). Orden por reserved_date descendente (más recientes primero).
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fromDate = request.nextUrl.searchParams.get("from");
  const toDate = request.nextUrl.searchParams.get("to");

  let query = supabase
    .from("equipment_reservations")
    .select(`
      id, inventory_item_id, reserved_date, assignment_id, reserved_by, created_at,
      inventory_items ( id, name, category ),
      assignments ( id, order_id, employee_id )
    `)
    .is("deleted_at", null)
    .order("reserved_date", { ascending: false })
    .limit(50);

  if (fromDate) {
    query = query.gte("reserved_date", fromDate);
  }
  if (toDate) {
    query = query.lte("reserved_date", toDate);
  }

  const { data, error } = await query;

  if (error) {
    console.error("admin/equipment-reservations error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ reservations: data || [] }, { status: 200 });
}

// POST /api/admin/equipment-reservations — reservar un implemento caro para un
// equipo/día. Un mismo implemento no puede reservarse dos veces el mismo día
// (índice único en la migración 048: inventory_item_id + reserved_date WHERE
// deleted_at IS NULL). Se valida acá también para dar un mensaje claro antes
// de depender solo del error de constraint de la base de datos.
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("inventory", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase, user: auth.user, roles: auth.roles,
    resource: "inventory", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const body = await request.json();
    const { inventoryItemId, reservedDate, assignmentId } = body;

    if (!inventoryItemId || !reservedDate) {
      return NextResponse.json(
        { error: "inventoryItemId y reservedDate son requeridos" },
        { status: 400 }
      );
    }

    const { data: existing, error: existingError } = await supabase
      .from("equipment_reservations")
      .select("id")
      .eq("inventory_item_id", inventoryItemId)
      .eq("reserved_date", reservedDate)
      .is("deleted_at", null)
      .limit(1);

    if (existingError) {
      console.error("admin/equipment-reservations error:", existingError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: "Ese implemento ya está reservado ese día por otro equipo." },
        { status: 409 }
      );
    }

    const { data: reserver } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    const { data, error } = await supabase
      .from("equipment_reservations")
      .insert({
        inventory_item_id: inventoryItemId,
        reserved_date: reservedDate,
        assignment_id: assignmentId || null,
        reserved_by: reserver?.id || null,
      })
      .select()
      .single();

    if (error) {
      // El índice único de la DB es la garantía final contra doble-booking
      // (ej: dos clics simultáneos que pasan el chequeo de arriba a la vez).
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Ese implemento ya está reservado ese día por otro equipo." },
          { status: 409 }
        );
      }
      console.error("admin/equipment-reservations error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ reservation: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

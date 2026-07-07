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

// GET /api/empleado/checklist?orderId=...&serviceSubtype=...
// Obtiene la plantilla de checklist + respuestas ya guardadas
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get("orderId");
    const serviceSubtype = searchParams.get("serviceSubtype");

    if (!orderId || !serviceSubtype) {
      return NextResponse.json({ error: "Missing orderId or serviceSubtype" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar perfil de empleado
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Obtener plantilla de checklist para este tipo de servicio
    const { data: checklists, error: checklistError } = await supabase
      .from("sop_checklists")
      .select("*")
      .eq("service_subtype", serviceSubtype)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (checklistError) {
      return NextResponse.json({ error: checklistError.message }, { status: 500 });
    }

    // Obtener respuestas ya guardadas para este order
    const { data: responses, error: respError } = await supabase
      .from("service_checklist_items")
      .select("*")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id);

    if (respError) {
      return NextResponse.json({ error: respError.message }, { status: 500 });
    }

    // Crear mapa de respuestas por itemId
    const responseMap = new Map();
    for (const r of responses || []) {
      responseMap.set(r.item_id, r);
    }

    // Combinar plantilla + respuestas
    const zones = (checklists || []).map((cl) => {
      const items = (cl.items || [])
        .filter((item: { active?: boolean }) => item.active !== false)
        .map((item: { id: string; label: string; required: boolean }) => {
          const resp = responseMap.get(item.id);
          return {
            itemId: item.id,
            label: item.label,
            required: item.required,
            isCompleted: resp?.is_completed || false,
            photoUrl: resp?.photo_url || undefined,
            notes: resp?.notes || undefined,
          };
        });

      const totalItems = items.length;
      const completedItems = items.filter((i: { isCompleted: boolean }) => i.isCompleted).length;
      const requiredItems = items.filter((i: { required: boolean }) => i.required).length;
      const requiredCompleted = items.filter((i: { required: boolean; isCompleted: boolean }) => i.required && i.isCompleted).length;

      return {
        checklistId: cl.id,
        zone: cl.zone,
        zoneLabel: cl.zone_label,
        zoneColor: cl.zone_color,
        zoneIcon: cl.zone_icon,
        totalItems,
        completedItems,
        requiredItems,
        requiredCompleted,
        items,
      };
    });

    // Calcular progreso global
    const totalItems = zones.reduce((sum, z) => sum + z.totalItems, 0);
    const completedItems = zones.reduce((sum, z) => sum + z.completedItems, 0);
    const requiredItems = zones.reduce((sum, z) => sum + z.requiredItems, 0);
    const requiredCompleted = zones.reduce((sum, z) => sum + z.requiredCompleted, 0);

    return NextResponse.json({
      zones,
      progress: {
        totalItems,
        completedItems,
        requiredItems,
        requiredCompleted,
        percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
        percentRequired: requiredItems > 0 ? Math.round((requiredCompleted / requiredItems) * 100) : 100,
      },
    }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/empleado/checklist
// Guarda o actualiza un ítem del checklist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, checklistId, itemId, itemLabel, isCompleted, photoUrl, notes } = body;

    if (!orderId || !checklistId || !itemId || !itemLabel) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar perfil de empleado
    const { data: employee, error: empError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (empError || !employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 403 });
    }

    // Verificar que el empleado tiene asignación para este order
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // Verificar si ya existe un registro para este item
    const { data: existing } = await supabase
      .from("service_checklist_items")
      .select("id")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .eq("checklist_id", checklistId)
      .eq("item_id", itemId)
      .single();

    let result;
    if (existing) {
      // Actualizar
      result = await supabase
        .from("service_checklist_items")
        .update({
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          photo_url: photoUrl || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();
    } else {
      // Insertar nuevo
      result = await supabase
        .from("service_checklist_items")
        .insert({
          order_id: orderId,
          employee_id: employee.id,
          checklist_id: checklistId,
          item_id: itemId,
          item_label: itemLabel,
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          photo_url: photoUrl || null,
          notes: notes || null,
        })
        .select()
        .single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, item: result.data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { isKitchenTimerExpired } from "@/lib/kitchen-timer";
import { ensureZoneAssignment } from "@/lib/zone-assignment";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { safeErrorResponse } from "@/lib/api-errors";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";

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
    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Fix auditoría implacable (2026-07-26, paso 5): este GET nunca
    // verificaba que el empleado tuviera una asignación real sobre
    // `orderId` antes de devolver el checklist (plantilla + respuestas +
    // reparto de zonas) -- mismo patrón de verificación de `assignments`
    // ya usado en /api/empleado/servicio/route.ts y
    // /api/empleado/upsells/route.ts.
    const { data: checklistAssignment, error: checklistAssignError } = await supabase
      .from("assignments")
      .select("id")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (checklistAssignError || !checklistAssignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // Obtener plantilla de checklist para este tipo de servicio
    const { data: checklistsRaw, error: checklistError } = await supabase
      .from("sop_checklists")
      .select("*")
      .is("deleted_at", null)
      .eq("service_subtype", serviceSubtype)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (checklistError) {
      return safeErrorResponse(checklistError, 500, "Ocurrió un error interno");
    }

    // v8.3 E4 (D.7): zonas add-on (ej. Garaje) solo aparecen en el checklist
    // de las órdenes donde el cliente las seleccionó en la cotización
    // (orders.addon_zones). Zonas del catálogo base (is_addon_zone=false)
    // no se filtran — siguen siempre presentes, sin cambio de comportamiento.
    const { data: orderForAddons } = await supabase
      .from("orders")
      .select("addon_zones")
      .eq("id", orderId)
      .maybeSingle();
    const selectedAddonZones = new Set<string>(orderForAddons?.addon_zones || []);
    const checklists = (checklistsRaw || []).filter(
      (cl: { is_addon_zone?: boolean; zone: string }) =>
        !cl.is_addon_zone || selectedAddonZones.has(cl.zone)
    );

    // Obtener respuestas ya guardadas para este order
    const { data: responses, error: respError } = await supabase
      .from("service_checklist_items")
      .select("*")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id);

    if (respError) {
      return safeErrorResponse(respError, 500, "Ocurrió un error interno");
    }

    // Crear mapa de respuestas por itemId
    const responseMap = new Map();
    for (const r of responses || []) {
      responseMap.set(r.item_id, r);
    }

    // v8.3 E4 (D.7): reparto de zonas por operario. Regla dura: con N>=2,
    // Cocina y Baño nunca van al mismo empleado. Se calcula (o se lee si ya
    // estaba calculado) para toda la orden, y aquí solo se filtra a las
    // zonas de ESTE empleado. Si el reparto no aplica (N=1) o falla por
    // cualquier motivo, se degrada a mostrar todas las zonas (nunca bloquea
    // al líder por un problema de infraestructura).
    let myZones: string[] | null = null;
    try {
      const plan = await ensureZoneAssignment(supabase, orderId);
      if (plan.size > 0) {
        myZones = plan.get(employee.id) ?? [];
      }
    } catch (e) {
      console.error("Zone assignment error (degrading to show all zones):", e);
    }

    // Combinar plantilla + respuestas
    const allZones = (checklists || []).map((cl) => {
      const items = (cl.items || [])
        .filter((item: { active?: boolean }) => item.active !== false)
        .map((item: { id: string; label: string; required: boolean; hotSurface?: boolean }) => {
          const resp = responseMap.get(item.id);
          return {
            itemId: item.id,
            label: item.label,
            required: item.required,
            isCompleted: resp?.is_completed || false,
            photoUrl: resp?.photo_url || undefined,
            notes: resp?.notes || undefined,
            // v8.3 E4 (D.7): timer de superficie caliente — bloquea el ítem
            // hasta que pasen 10 min desde que el empleado lo inició.
            hotSurface: item.hotSurface === true,
            hotSurfaceTimerStartedAt: resp?.hot_surface_timer_started_at || null,
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

    // v8.3 E4 (D.7): si el reparto real produjo una lista (aunque sea
    // vacía) para este empleado, filtrar a solo sus zonas. Un array vacío
    // es una respuesta válida (el reparto ya corrió y a este empleado no le
    // tocó ninguna zona nueva) y se respeta — null es lo único que significa
    // "no se pudo calcular, mostrar todo".
    const zones = myZones !== null ? allZones.filter((z) => myZones!.includes(z.zone)) : allZones;

    // Calcular progreso global
    const totalItems = zones.reduce((sum, z) => sum + z.totalItems, 0);
    const completedItems = zones.reduce((sum, z) => sum + z.completedItems, 0);
    const requiredItems = zones.reduce((sum, z) => sum + z.requiredItems, 0);
    const requiredCompleted = zones.reduce((sum, z) => sum + z.requiredCompleted, 0);

    return NextResponse.json({
      zones,
      myZones,
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
    return safeErrorResponse(err, 500, "Ocurrió un error interno");
  }
}

// POST /api/empleado/checklist
// Guarda o actualiza un ítem del checklist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, checklistId, itemId, itemLabel, isCompleted, photoUrl, notes, startHotSurfaceTimer } = body;

    if (!orderId || !checklistId || !itemId || !itemLabel) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Buscar perfil de empleado
    const { employee, error: empError, status: empStatus } = await requireActiveEmployee(supabase, user.id);

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    // Verificar que el empleado tiene asignación para este order
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .select("id, zones, status")
      .is("deleted_at", null)
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .single();

    if (assignError || !assignment) {
      return NextResponse.json({ error: "No assignment found for this service" }, { status: 403 });
    }

    // Fix (auditoría 2026-07-31, #12): antes se podía marcar/editar ítems
    // del checklist (incluida evidencia de químicos/fotos) sin importar el
    // estado de la asignación -- incluyendo servicios ya 'completed' o
    // 'cancelled'. Solo se permite mientras el servicio sigue activo en
    // campo.
    if (!["arrived", "in_progress"].includes(assignment.status)) {
      return NextResponse.json(
        { error: "This assignment is no longer active -- the checklist can't be edited." },
        { status: 409 }
      );
    }

    // v8.3 E4 (D.7): regla dura del reparto — si esta orden ya tiene zonas
    // repartidas (assignment.zones no-nulo, típico con N>=2), el empleado
    // solo puede tocar ítems de SU zona. Esto es el candado real: la UI ya
    // filtra lo que se ve (GET), esto impide que se evada con una llamada
    // directa a la API. Con N=1 (zones NULL) no aplica, cubre todo.
    if (assignment.zones !== null) {
      const { data: checklistRow } = await supabase
        .from("sop_checklists")
        .select("zone")
        .eq("id", checklistId)
        .maybeSingle();
      const itemZone = checklistRow?.zone;
      if (itemZone && !(assignment.zones as string[]).includes(itemZone)) {
        return NextResponse.json(
          { error: "This zone is assigned to a different operator on this service." },
          { status: 403 }
        );
      }
    }

    // v8.3 E4 (D.7): ¿es un ítem de superficie caliente (estufa/campana)?
    // Se lee del checklist SOP, no del body — el cliente nunca decide esto.
    const { data: checklistZone } = await supabase
      .from("sop_checklists")
      .select("items, zone_color")
      .eq("id", checklistId)
      .maybeSingle();
    const itemDef = ((checklistZone?.items as { id: string; hotSurface?: boolean }[]) || []).find(
      (i) => i.id === itemId
    );
    const isHotSurfaceItem = itemDef?.hotSurface === true;

    // v8.3 E4 fix (auditoría 2026-07-18) [CRÍTICO] — poka-yoke químico sin
    // enforcement server-side. Antes, la confirmación de color+ícono+texto
    // (ChemicalMatchModal.tsx) solo vivía en un useState del cliente:
    // cualquier llamada directa a esta API con isCompleted=true marcaba el
    // ítem como hecho sin haber confirmado nunca el producto correcto para
    // esa zona de riesgo químico. Ahora se exige una fila real en
    // chemical_zone_confirmations (persistida por
    // POST /api/empleado/chemical-confirm, que revalida color+ícono+texto
    // server-side) antes de aceptar is_completed=true.
    const zoneColor = checklistZone?.zone_color;
    if (isCompleted === true && zoneColor) {
      const { data: confirmation } = await supabase
        .from("chemical_zone_confirmations")
        .select("id")
        .eq("order_id", orderId)
        .eq("employee_id", employee.id)
        .eq("zone_color", zoneColor)
        .maybeSingle();

      if (!confirmation) {
        return NextResponse.json(
          {
            error:
              "Candado químico: confirma el producto correcto para esta zona (color, ícono y texto) antes de marcar ítems como completados.",
          },
          { status: 403 }
        );
      }
    }

    // Verificar si ya existe un registro para este item (con RLS, solo ve los del empleado)
    const { data: existing } = await supabase
      .from("service_checklist_items")
      .select("id, hot_surface_timer_started_at")
      .eq("order_id", orderId)
      .eq("employee_id", employee.id)
      .eq("checklist_id", checklistId)
      .eq("item_id", itemId)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const existingTimerStart = existing?.hot_surface_timer_started_at ?? null;

    // Bloqueo real (no solo en UI): si es superficie caliente y se intenta
    // completar antes de que venzan los 10 min, se rechaza en el servidor.
    if (isHotSurfaceItem && isCompleted && !isKitchenTimerExpired(existingTimerStart, nowIso)) {
      return NextResponse.json(
        { error: "Superficie caliente: espera el temporizador de 10 min antes de marcar este ítem." },
        { status: 409 }
      );
    }

    const hotSurfaceTimerStartedAt =
      isHotSurfaceItem && startHotSurfaceTimer
        ? existingTimerStart ?? nowIso // nunca reinicia un timer ya en curso
        : existingTimerStart;

    let result;
    if (existing) {
      // Actualizar con verificación de ownership implícita por RLS
      result = await supabase
        .from("service_checklist_items")
        .update({
          is_completed: isCompleted,
          completed_at: isCompleted ? nowIso : null,
          photo_url: photoUrl || null,
          notes: notes || null,
          hot_surface_timer_started_at: hotSurfaceTimerStartedAt,
          updated_at: nowIso,
        })
        .eq("id", existing.id)
        .eq("employee_id", employee.id) // Doble verificación: RLS + query explícita
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
          completed_at: isCompleted ? nowIso : null,
          photo_url: photoUrl || null,
          notes: notes || null,
          hot_surface_timer_started_at: hotSurfaceTimerStartedAt,
        })
        .select()
        .single();
    }

    if (result.error) {
      return safeErrorResponse(result.error, 500, "Ocurrió un error interno");
    }

    return NextResponse.json({ success: true, item: result.data }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err, 500, "Ocurrió un error interno");
  }
}

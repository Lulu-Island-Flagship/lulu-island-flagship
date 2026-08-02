import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

// Fix (auditoría externa, hallazgo A12): esta ruta usa `cookies()`
// (request-time) -- sin esto Next intentaba pre-renderizarla en build,
// generando warnings y riesgo de caché incorrecta.
export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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
  });
}

/**
 * GET /api/empleado/jornada/precarga
 *
 * v8.3 E4 (D.10.1-2, criterio de aceptación E4 #1): "descarga de
 * ruta+SOP+fotos+accesos a SQLite local (offline completo)". Antes de esto,
 * el service worker (public/sw.js) solo cacheaba el shell HTML/JS de la
 * PWA — cero datos de servicio. Un empleado que salía del punto de
 * encuentro sin señal no tenía ninguna orden, dirección ni checklist
 * disponible hasta reconectar. Este endpoint junta en UNA sola llamada todo
 * lo que el líder necesita para trabajar el día completo sin red, para que
 * el cliente lo guarde en IndexedDB al iniciar jornada
 * (src/lib/offline-day-cache.ts).
 *
 * Alcance real: NO incluye fotos de referencia del cliente (esas ya se
 * suben on-demand vía Supabase Storage con cache HTTP normal, no hay hoy un
 * campo de "foto de referencia de propiedad" separado que descargar). Los
 * "accesos" son lo que existe hoy en el sistema: el último registro de
 * key_handling_log por orden, si el admin ya lo cargó — no existe todavía
 * un campo estructurado de instrucciones de acceso en client_properties.
 */
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee, error: empError, status: empStatus } = await requireActiveEmployee<{
      id: string;
      name: string | null;
      role: string | null;
    }>(supabase, user.id, "id, name, role");

    if (!employee) {
      return NextResponse.json({ error: empError }, { status: empStatus });
    }

    const vancouverDate = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const today = vancouverDate.split(",")[0];

    // Órdenes de HOY (no futuras — la precarga es para la jornada de hoy).
    const { data: todaysOrders, error: ordersError } = await supabase
      .from("orders")
      .select(`
        id,
        service_date,
        service_time,
        status,
        quote_id,
        address_lat,
        address_lng,
        addon_zones,
        quotes:quote_id ( address, zone, service_subtype, square_feet, bedrooms, bathrooms )
      `)
      .eq("service_date", today);

    if (ordersError) {
      console.error("ordersError:", ordersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const todaysOrderIds = (todaysOrders || []).map((o) => o.id);
    if (todaysOrderIds.length === 0) {
      return NextResponse.json(
        { date: today, employee: { id: employee.id, name: employee.name }, services: [], checklistsBySubtype: {} },
        { status: 200 }
      );
    }

    const { data: assignments } = await supabase
      .from("assignments")
      .select("id, order_id, status, zones")
      .is("deleted_at", null)
      .eq("employee_id", employee.id)
      .in("order_id", todaysOrderIds)
      .neq("status", "cancelled");

    const myOrderIds = new Set((assignments || []).map((a) => a.order_id));
    const myOrders = (todaysOrders || []).filter((o) => myOrderIds.has(o.id));

    // Último registro de acceso conocido por orden (si el admin ya lo cargó).
    const { data: keyLogs } = await supabase
      .from("key_handling_log")
      .select("order_id, method, lockbox_code, created_at")
      .in("order_id", Array.from(myOrderIds))
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const latestKeyLogByOrder = new Map<string, { method: string; lockbox_code: string | null }>();
    for (const log of keyLogs || []) {
      if (!latestKeyLogByOrder.has(log.order_id)) {
        latestKeyLogByOrder.set(log.order_id, { method: log.method, lockbox_code: log.lockbox_code });
      }
    }

    // SOP completo (zonas + items) para cada service_subtype distinto del día
    // — se descarga una vez por subtipo, no una vez por orden.
    const subtypes = Array.from(
      new Set(
        myOrders
          .map((o) => (o.quotes as unknown as { service_subtype?: string } | null)?.service_subtype)
          .filter((s): s is string => !!s)
      )
    );

    const checklistsBySubtype: Record<string, unknown[]> = {};
    if (subtypes.length > 0) {
      const { data: checklists } = await supabase
        .from("sop_checklists")
        .select("id, service_subtype, zone, zone_label, zone_color, zone_icon, items, sort_order, is_addon_zone")
        .is("deleted_at", null)
        .eq("is_active", true)
        .in("service_subtype", subtypes)
        .order("sort_order", { ascending: true });

      for (const cl of checklists || []) {
        const key = cl.service_subtype as string;
        if (!checklistsBySubtype[key]) checklistsBySubtype[key] = [];
        checklistsBySubtype[key].push(cl);
      }
    }

    const services = myOrders.map((o) => {
      const quote = o.quotes as unknown as {
        address?: string;
        zone?: string;
        service_subtype?: string;
        square_feet?: number;
        bedrooms?: number;
        bathrooms?: number;
      } | null;
      const assignment = (assignments || []).find((a) => a.order_id === o.id);
      const keyAccess = latestKeyLogByOrder.get(o.id);
      return {
        orderId: o.id,
        serviceTime: o.service_time,
        address: quote?.address || "",
        zone: quote?.zone || "",
        serviceSubtype: quote?.service_subtype || "",
        squareFeet: quote?.square_feet || 0,
        bedrooms: quote?.bedrooms || 0,
        bathrooms: quote?.bathrooms || 0,
        addonZones: o.addon_zones || [],
        myAssignedZones: assignment?.zones ?? null,
        keyAccess: keyAccess ? { method: keyAccess.method, lockboxCode: keyAccess.lockbox_code } : null,
      };
    });

    return NextResponse.json(
      {
        date: today,
        employee: { id: employee.id, name: employee.name },
        downloadedAt: new Date().toISOString(),
        services,
        checklistsBySubtype,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";

import { SERVICE_TYPES, type ServiceType } from "@/lib/pricing";
import { computeClientSegment, type ClientSegment } from "@/lib/client-segmentation";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

// Fix (auditoría externa, hallazgo A12): esta ruta lee `request.url`
// (request-time) -- sin esto Next intentaba pre-renderizarla en build,
// generando warnings y riesgo de caché incorrecta.
export const dynamic = "force-dynamic";
// v8.3 E3 fix: buffer de emergencia invisible al cliente. Antes Slots =
// Capacidad_Neta - HHE_comprometidas (sin buffer), así que un día podía
// venderse al 100% de su capacidad publicada sin dejar margen para SOS,
// no-shows encadenados o reasignaciones de último minuto. Ahora se retiene
// 1 slot/día por zona: Slots = Capacidad_Neta - HHE_comprometidas - buffer.
// El buffer NUNCA se expone en la respuesta (ni como campo, ni como razón en
// blockedReason) -- el cliente solo ve available:false, igual que un slot
// realmente lleno.
const EMERGENCY_BUFFER_SLOTS_PER_DAY = 1;

function applyEmergencyBuffer<T extends { available: boolean; maxTeams: number; committedTeams: number }>(
  slots: T[]
): T[] {
  // Presupuesto de "unidades de capacidad" restantes del día para esta
  // zona, después de restar el buffer. Cada slot disponible consume su
  // propia capacidad remanente (maxTeams - committedTeams) del presupuesto;
  // en cuanto el presupuesto se agota, los slots siguientes (los últimos en
  // orden cronológico, no necesariamente los últimos del array) se marcan
  // no disponibles -- exactamente como si estuvieran llenos.
  const totalRemaining = slots.reduce(
    (sum, s) => sum + Math.max(0, s.maxTeams - s.committedTeams),
    0
  );
  let budget = totalRemaining - EMERGENCY_BUFFER_SLOTS_PER_DAY;

  return slots.map((s) => {
    if (!s.available) return s;
    const slotRemaining = Math.max(0, s.maxTeams - s.committedTeams);
    if (budget <= 0) {
      budget -= slotRemaining;
      return { ...s, available: false };
    }
    budget -= slotRemaining;
    return s;
  });
}

// GET /api/capacity?date=YYYY-MM-DD&zone=Richmond&serviceType=regular&squareFeet=1000
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const zone = searchParams.get("zone") || undefined;
    // Fix (auditoría MANIFEST v4.2 · C.1 "sin inyección"): `zone` se interpola
    // en un filtro .or() de PostgREST más abajo. Un valor con comillas/comas
    // rompería la gramática del filtro. Allow-list estricto (letras/dígitos,
    // espacio, apóstrofo, guion, ampersand) — sin `"`, `,`, `.`, `(`, `)`, `%`, `_`.
    if (zone && !/^[A-Za-zÀ-ÖØ-öø-ÿ0-9 '&-]{1,64}$/.test(zone)) {
      return NextResponse.json({ error: "Invalid zone" }, { status: 400 });
    }
    const serviceType = searchParams.get("serviceType") as ServiceType | null;
    const squareFeetParam = searchParams.get("squareFeet");

    if (!date) {
      return NextResponse.json({ error: "date is required" }, { status: 400 });
    }

    const squareFeet = squareFeetParam ? Number(squareFeetParam) : undefined;
    if (serviceType && (!squareFeet || squareFeet <= 0)) {
      return NextResponse.json(
        { error: "squareFeet is required when serviceType is provided" },
        { status: 400 }
      );
    }

    if (serviceType && !SERVICE_TYPES.some((t) => t.key === serviceType)) {
      return NextResponse.json({ error: "Invalid serviceType" }, { status: 400 });
    }

    const supabase = await createRouteSupabaseClient();

    // Validar corte de reserva a las 5 PM del día anterior
    const vancouverNowStr = new Date().toLocaleString("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const todayStr = vancouverNowStr.split(",")[0];
    const hour = Number(vancouverNowStr.split(", ")[1]?.split(":")[0] ?? 0);

    // Fix 2026-07-24 (auditoría externa): antes `cutoffLocked` solo evaluaba
    // `date > todayStr && hour >= 17`, así que reservas para HOY (date ===
    // todayStr) nunca activaban el corte sin importar la hora -- un cliente
    // podía, en teoría, ver disponibilidad para "hoy" incluso a las 11pm. En
    // la práctica esto rara vez se notaba porque los slots de same-day
    // normalmente no llegan a is_published=true bajo el modelo de corte de
    // las 5PM del día anterior, pero nada en el código lo garantiza -- si un
    // operador publica slots same-day manualmente, el hueco era real. Se
    // aplica ahora la MISMA hora de corte (BOOKING_CUTOFF_HOUR-equivalente,
    // 17:00) a same-day que ya se usaba para "mañana", cerrando el hueco.
    // Nota: no hay ninguna pista en el código de que same-day deba tener una
    // hora de corte distinta/más temprana que el corte para el día
    // siguiente, así que se reutiliza la misma constante por simplicidad.
    const cutoffLocked = date >= todayStr && hour >= 17;

    let query = supabase
      .from("capacity_slots")
      .select("id, service_date, start_time, end_time, zone, slot_type, max_teams, committed_teams, blocked_reason, is_published")
      .eq("service_date", date)
      .eq("is_published", true)
      .order("start_time", { ascending: true });

    if (zone) {
      query = query.or(`zone.eq."${zone}",zone.is.null`);
    }

    const { data: slots, error } = await query;

    if (error) {
      console.error("Capacity fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Si no hay slots publicados, generar slots flexibles por defecto
    let enriched = (slots || []).map((s) => ({
      id: s.id,
      serviceDate: s.service_date,
      startTime: s.start_time,
      endTime: s.end_time,
      zone: s.zone,
      slotType: s.slot_type,
      maxTeams: s.max_teams,
      committedTeams: s.committed_teams,
      blockedReason: s.blocked_reason,
      isPublished: s.is_published,
      available: s.slot_type !== "blocked" && s.committed_teams < s.max_teams && !cutoffLocked,
    }));

    if (enriched.length === 0 && !cutoffLocked) {
      const defaultSlots = [
        "08:00", "08:30", "09:00", "09:30", "10:00", "10:30",
        "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
        "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
      ];
      enriched = defaultSlots.map((startTime) => {
        const [h, m] = startTime.split(":").map(Number);
        const endH = h + Math.floor((m + 30) / 60);
        const endM = (m + 30) % 60;
        return {
          id: `${date}-${startTime}`,
          serviceDate: date,
          startTime,
          endTime: `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`,
          zone,
          slotType: "flexible" as const,
          maxTeams: 1,
          committedTeams: 0,
          blockedReason: null,
          isPublished: true,
          available: true,
        };
      });
    }

    if (!cutoffLocked) {
      enriched = applyEmergencyBuffer(enriched);
    }

    // v8.3 fix (auditoría E1 2026-07-18): no existía prioridad de slots
    // Recurrente > Esporádico > Nuevo, ni el límite de 1 reserva activa para
    // clientes Nuevos hasta completar su primer servicio sin disputa -- un
    // cliente Nuevo podía competir en igualdad de condiciones por el último
    // cupo del día contra un cliente Recurrente de años, y podía además
    // acumular varias reservas activas simultáneas antes de tener ningún
    // historial real con la empresa.
    let newClientLimitReached = false;
    let clientSegment: ClientSegment | null = null;

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("client_profiles")
        .select("services_count, score")
        .eq("user_id", user.id)
        .maybeSingle();

      const totalServicesCount = profile?.services_count ?? 0;

      const { data: lastOrder } = await supabase
        .from("orders")
        .select("service_datetime")
        .eq("user_id", user.id)
        .eq("status", "completed")
        .order("service_datetime", { ascending: false })
        .limit(1)
        .maybeSingle();

      const daysSinceLastService = lastOrder?.service_datetime
        ? Math.max(0, Math.round((Date.now() - new Date(lastOrder.service_datetime).getTime()) / (1000 * 60 * 60 * 24)))
        : 9999;

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentOrders } = await supabase
        .from("orders")
        .select("total_paid_cents")
        .eq("user_id", user.id)
        .gte("service_datetime", thirtyDaysAgo);
      // RAÍZ-3 (2026-07-21, migración 229): total_paid_cents ya está en
      // centavos -- sin *100.
      const monthlySpendCents = Math.round(
        (recentOrders || []).reduce((sum, o) => sum + Number(o.total_paid_cents || 0), 0)
      );

      clientSegment = computeClientSegment({
        monthlySpendCents,
        totalServicesCount,
        daysSinceLastService,
      });

      if (clientSegment === "new") {
        // Límite: 1 reserva activa hasta completar el primer servicio sin
        // disputa. "Activa" = no cancelada; "sin disputa" ya está implícito
        // porque services_count solo sube cuando el servicio se completó sin
        // disputa abierta (ver score/E5). Mientras totalServicesCount sea 0,
        // cualquier orden activa existente agota el cupo del cliente Nuevo.
        if (totalServicesCount === 0) {
          const { data: activeOrders } = await supabase
            .from("orders")
            .select("id")
            .eq("user_id", user.id)
            .neq("status", "cancelled")
            .neq("status", "completed");
          newClientLimitReached = (activeOrders?.length ?? 0) >= 1;
        }

        // Prioridad Recurrente > Esporádico > Nuevo: en el/los últimos cupos
        // del día (después del buffer de emergencia), un cliente Nuevo no
        // puede tomar el cupo -- se reserva para clientes con historial. No
        // afecta la disponibilidad general (otros clientes sí lo ven
        // disponible); solo lo que esta respuesta, para ESTE cliente, marca
        // como reservable.
        enriched = enriched.map((s) => {
          if (!s.available) return s;
          const remaining = s.maxTeams - s.committedTeams;
          if (remaining <= 1) {
            return {
              ...s,
              available: false,
              blockedReason: "Priority slot reserved for returning clients during high demand",
            };
          }
          return s;
        });
      }
    }

    return NextResponse.json(
      {
        date,
        zone,
        cutoffLocked,
        slots: enriched,
        clientSegment,
        newClientLimitReached,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SERVICE_TYPES, type ServiceType } from "@/lib/pricing";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl, supabaseKey, {
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
  });
}

// GET /api/capacity?date=YYYY-MM-DD&zone=Richmond&serviceType=regular&squareFeet=1000
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const zone = searchParams.get("zone") || undefined;
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

    const supabase = getSupabaseClient();

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

    // Si es posterior al corte de hoy para mañana, marcar que mañana está bloqueado
    const cutoffLocked = date > todayStr && hour >= 17;

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
      return NextResponse.json({ error: error.message }, { status: 500 });
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

    return NextResponse.json(
      {
        date,
        zone,
        cutoffLocked,
        slots: enriched,
      },
      { status: 200 }
    );
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Capacity API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

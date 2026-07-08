import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { calculateTeamRequirements, getHHEForRange, type ServiceType } from "@/lib/pricing";

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

function getVancouverNow(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const h = parts.find((p) => p.type === "hour")?.value;
  const min = parts.find((p) => p.type === "minute")?.value;
  const s = parts.find((p) => p.type === "second")?.value;
  return new Date(`${y}-${m}-${d}T${h}:${min}:${s}`);
}

function getTomorrowDate(): string {
  const now = getVancouverNow();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
}

function detectPhase(): "proposal" | "cutoff" | "published" | "simulation" | "crisis_fallback" {
  const now = getVancouverNow();
  const h = now.getHours();
  const m = now.getMinutes();

  // 4:30 PM — propuesta de equipos
  if (h === 16 && m >= 30 && m < 45) return "proposal";
  // 5:00 PM — corte, validación final
  if (h === 17 && m >= 0 && m < 15) return "cutoff";
  // 5:30 PM — publicación
  if (h === 17 && m >= 30 && m < 45) return "published";
  // 12:00 PM — simulación del día
  if (h === 12 && m >= 0 && m < 15) return "simulation";
  // Fallback de crisis: cualquier otra hora del día con flag manual
  return "crisis_fallback";
}

interface ProposedOrder {
  orderId: string;
  quoteId: string;
  serviceType: ServiceType;
  squareFeet: number;
  zone: string;
  serviceTime: string;
  hheHours: number;
  minTeams: number;
  maxTeams: number;
  proposedEmployeeIds: string[];
}

async function buildProposals(supabase: ReturnType<typeof getSupabaseClient>, targetDate: string) {
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, quote_id, service_time")
    .eq("service_date", targetDate)
    .neq("status", "cancelled")
    .neq("status", "completed")
    .order("service_time", { ascending: true });

  if (ordersError) throw ordersError;
  if (!orders || orders.length === 0) return { proposals: [] as ProposedOrder[], availableTeams: 0 };

  const quoteIds = orders.map((o) => o.quote_id);
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, service_type, square_feet, zone")
    .in("id", quoteIds);

  const quoteMap = new Map((quotes || []).map((q) => [q.id, q]));

  const { data: employees } = await supabase
    .from("employees")
    .select("id, role, is_active, home_zone, trust_level, vehicle_id")
    .eq("is_active", true)
    .in("role", ["cleaner", "supervisor"]);

  const availableEmployees = (employees || []).filter((e) => e.is_active);
  const availableTeams = availableEmployees.length;

  const proposals: ProposedOrder[] = [];
  const assignedEmployeeIds = new Set<string>();

  for (const order of orders || []) {
    const quote = quoteMap.get(order.quote_id);
    if (!quote) continue;

    const serviceType = quote.service_type as ServiceType;
    const squareFeet = quote.square_feet as number;
    const hheHours = getHHEForRange(serviceType, squareFeet);
    const { minTeams, maxTeams } = calculateTeamRequirements(serviceType, squareFeet, "b2c");

    // Asignar empleados disponibles preferentemente de la misma zona
    const candidates = availableEmployees
      .filter((e) => !assignedEmployeeIds.has(e.id))
      .sort((a, b) => {
        const aSameZone = a.home_zone === quote.zone ? 1 : 0;
        const bSameZone = b.home_zone === quote.zone ? 1 : 0;
        const aTrust = a.trust_level === "elite" ? 2 : a.trust_level === "standard" ? 1 : 0;
        const bTrust = b.trust_level === "elite" ? 2 : b.trust_level === "standard" ? 1 : 0;
        return bSameZone - aSameZone || bTrust - aTrust;
      });

    const teamSize = Math.min(maxTeams, Math.max(minTeams, 1));
    const proposed = candidates.slice(0, teamSize);

    for (const e of proposed) {
      assignedEmployeeIds.add(e.id);
    }

    proposals.push({
      orderId: order.id,
      quoteId: order.quote_id,
      serviceType,
      squareFeet,
      zone: quote.zone as string,
      serviceTime: order.service_time,
      hheHours,
      minTeams,
      maxTeams,
      proposedEmployeeIds: proposed.map((e) => e.id),
    });
  }

  return { proposals, availableTeams };
}

async function persistAssignments(
  supabase: ReturnType<typeof getSupabaseClient>,
  proposals: ProposedOrder[],
  autoApproved: boolean
) {
  let assigned = 0;
  for (const p of proposals) {
    if (p.proposedEmployeeIds.length === 0) continue;

    await supabase.from("assignments").delete().eq("order_id", p.orderId);

    const assignments = p.proposedEmployeeIds.map((employeeId) => ({
      order_id: p.orderId,
      employee_id: employeeId,
      status: "pending" as const,
      notes: autoApproved ? "Auto-assigned by scheduler" : "Proposed by scheduler",
    }));

    const { error } = await supabase.from("assignments").insert(assignments);
    if (!error) assigned += assignments.length;
  }
  return assigned;
}

// GET /api/cron/dispatch-scheduler
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const phase = detectPhase();
  const targetDate = getTomorrowDate();

  try {
    let result: Record<string, unknown> = { phase, targetDate };

    if (phase === "proposal") {
      const { proposals, availableTeams } = await buildProposals(supabase, targetDate);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        notes: `Proposed ${proposals.filter((p) => p.proposedEmployeeIds.length > 0).length} orders`,
      });
      result = { ...result, proposals, availableTeams };
    }

    if (phase === "cutoff") {
      const { proposals, availableTeams } = await buildProposals(supabase, targetDate);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        notes: `Cutoff validation: ${proposals.filter((p) => p.proposedEmployeeIds.length > 0).length} orders ready`,
      });
      result = { ...result, proposals, availableTeams };
    }

    if (phase === "published") {
      const { proposals, availableTeams } = await buildProposals(supabase, targetDate);
      // Autopilot: con 6+ equipos disponibles, auto-aprobar
      const autoApproved = availableTeams >= 6;
      const assigned = await persistAssignments(supabase, proposals, autoApproved);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        auto_approved: autoApproved,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        orders_assigned: assigned,
        notes: autoApproved ? "Auto-approved (6+ teams available)" : "Published for manual review",
      });
      result = { ...result, proposals, availableTeams, autoApproved, assigned };
    }

    if (phase === "simulation") {
      // Simulación 12:00 PM del día del servicio: detectar gaps y reasignar si es posible
      const today = getVancouverNow().toISOString().split("T")[0];
      const { proposals, availableTeams } = await buildProposals(supabase, today);
      const unassigned = proposals.filter((p) => p.proposedEmployeeIds.length === 0);
      const assigned = await persistAssignments(supabase, proposals, true);
      await supabase.from("dispatch_runs").insert({
        run_date: today,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        orders_assigned: assigned,
        notes: `12PM simulation: ${unassigned.length} orders without team`,
      });
      result = { ...result, proposals, availableTeams, assigned, unassignedCount: unassigned.length };
    }

    if (phase === "crisis_fallback") {
      // Fallback de crisis: reasignar órdenes del día sin equipo con cualquier empleado disponible
      const today = getVancouverNow().toISOString().split("T")[0];
      const { data: unassignedOrders } = await supabase
        .from("orders")
        .select("id")
        .eq("service_date", today)
        .neq("status", "cancelled")
        .neq("status", "completed");

      const orderIds = (unassignedOrders || []).map((o) => o.id);
      const { data: existingAssignments } = orderIds.length > 0
        ? await supabase.from("assignments").select("order_id").in("order_id", orderIds)
        : { data: [] };

      const assignedOrderIds = new Set((existingAssignments || []).map((a) => a.order_id));
      const crisisOrders = (unassignedOrders || []).filter((o) => !assignedOrderIds.has(o.id));

      const { data: availableEmployees } = await supabase
        .from("employees")
        .select("id")
        .eq("is_active", true)
        .in("role", ["cleaner", "supervisor"]);

      let recovered = 0;
      for (const o of crisisOrders) {
        const emp = (availableEmployees || []).find(() => true);
        if (!emp) break;
        const { error } = await supabase.from("assignments").insert({
          order_id: o.id,
          employee_id: emp.id,
          status: "pending",
          notes: "Crisis fallback assignment",
        });
        if (!error) recovered += 1;
      }

      await supabase.from("dispatch_runs").insert({
        run_date: today,
        phase,
        teams_available: availableEmployees?.length || 0,
        orders_processed: crisisOrders.length,
        orders_assigned: recovered,
        notes: `Crisis fallback recovered ${recovered} orders`,
      });
      result = { ...result, crisisOrders: crisisOrders.length, recovered };
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dispatch scheduler error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

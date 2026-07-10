import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { calculateTeamRequirements, getHHEForRange, type ServiceType } from "@/lib/pricing";
import { buildTeam, type DispatchCandidate } from "@/lib/dispatch-team";
import { evaluateWorkday } from "@/lib/workday";
import { isVehicleInsuranceExpired } from "@/lib/vehicle-insurance";
import {
  evaluateDispatchDiscrepancyFallback,
  type DispatchDiscrepancyReason,
} from "@/lib/dispatch-fallback";

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
    .select("id, quote_id, user_id, service_time")
    .eq("service_date", targetDate)
    .neq("status", "cancelled")
    .neq("status", "completed")
    .order("service_time", { ascending: true });

  if (ordersError) throw ordersError;
  if (!orders || orders.length === 0)
    return {
      proposals: [] as ProposedOrder[],
      availableTeams: 0,
      pendingLanguage: [] as string[],
      discrepancies: [] as { orderId: string; reason: DispatchDiscrepancyReason }[],
    };

  const quoteIds = orders.map((o) => o.quote_id);
  const { data: quotes } = await supabase
    .from("quotes")
    .select("id, service_type, square_feet, zone")
    .in("id", quoteIds);

  const quoteMap = new Map((quotes || []).map((q) => [q.id, q]));

  // v8.3 B.2.13: idiomas de la cuenta del cliente (migración 044)
  const userIds = Array.from(new Set(orders.map((o) => o.user_id)));
  const { data: clientProfiles } = await supabase
    .from("client_profiles")
    .select("user_id, preferred_languages")
    .in("user_id", userIds);
  const langMap = new Map(
    (clientProfiles || []).map((p) => [p.user_id, (p.preferred_languages as string[]) ?? ["en"]])
  );

  const { data: employees } = await supabase
    .from("employees")
    .select("id, role, is_active, home_zone, trust_level, vehicle_id, languages")
    .eq("is_active", true)
    .in("role", ["cleaner", "supervisor"]);

  // v8.3 E7 — el trigger SQL prevent_expired_vehicle_assignment (migración 047)
  // bloquea ASIGNAR un vehículo con seguro vencido a employees.vehicle_id, pero
  // NO bloqueo retroactivamente si el seguro vence DESPUÉS de la asignación ya
  // existente. El despacho diario es el punto real de riesgo: un empleado con
  // un vehículo cuyo seguro ya venció no debe recibir servicios nuevos hoy.
  const vehicleIds = Array.from(
    new Set((employees || []).map((e) => e.vehicle_id).filter((v): v is string => !!v))
  );
  const vehicleInsuranceExpiryById = new Map<string, string | null>();
  if (vehicleIds.length > 0) {
    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id, insurance_expiry_date")
      .in("id", vehicleIds);
    for (const v of vehicles || []) {
      vehicleInsuranceExpiryById.set(v.id, v.insurance_expiry_date as string | null);
    }
  }
  const todayIso = getVancouverNow().toISOString().split("T")[0];
  const expiredInsuranceEmployeeIds = new Set(
    (employees || [])
      .filter((e) => e.vehicle_id && isVehicleInsuranceExpired(vehicleInsuranceExpiryById.get(e.vehicle_id) ?? null, todayIso))
      .map((e) => e.id)
  );

  const availableEmployees = (employees || []).filter(
    (e) => e.is_active && !expiredInsuranceEmployeeIds.has(e.id)
  );
  const availableTeams = availableEmployees.length;

  const proposals: ProposedOrder[] = [];
  const pendingLanguage: string[] = [];
  // v8.3 E3 (B.2.12): registro estructurado de discrepancias de despacho
  // (sin líder, sin match de idioma, jornada bloqueada) para poder aplicarles
  // el fallback de 10 min — pendingLanguage arriba solo guarda texto para
  // logs, nunca tuvo forma estructurada para un timer.
  const discrepancies: { orderId: string; reason: DispatchDiscrepancyReason }[] = [];
  const assignedEmployeeIds = new Set<string>();

  if (expiredInsuranceEmployeeIds.size > 0) {
    pendingLanguage.push(
      `${expiredInsuranceEmployeeIds.size} empleado(s) excluido(s) del despacho: seguro de su vehículo vencido (v8.3 E7).`
    );
  }

  for (const order of orders || []) {
    const quote = quoteMap.get(order.quote_id);
    if (!quote) continue;

    const serviceType = quote.service_type as ServiceType;
    const squareFeet = quote.square_feet as number;
    const hheHours = getHHEForRange(serviceType, squareFeet);
    const { minTeams, maxTeams } = calculateTeamRequirements(serviceType, squareFeet, "b2c");
    const teamSize = Math.min(maxTeams, Math.max(minTeams, 1));

    // v8.3 E3 — reglas duras: líder obligatorio + match de idioma (buildTeam, testeado)
    const candidates: DispatchCandidate[] = availableEmployees
      .filter((e) => !assignedEmployeeIds.has(e.id))
      .map((e) => ({
        id: e.id,
        role: e.role as DispatchCandidate["role"],
        languages: (e.languages as string[]) ?? ["en"],
        homeZone: e.home_zone as string | null,
        trustLevel: (e.trust_level as string) ?? "standard",
      }));

    const clientLanguages = langMap.get(order.user_id) ?? ["en"];
    const result = buildTeam(candidates, clientLanguages, teamSize, quote.zone as string);

    if (result.team === null) {
      // Invariante B.2.13 / M0-F0.5: sin líder o sin match de idioma NO se
      // asigna solo — la orden queda pendiente para resolución del admin.
      pendingLanguage.push(
        `${order.id}: ${result.pendingReason}${result.warnings.length ? ` (${result.warnings[0]})` : ""}`
      );
      discrepancies.push({ orderId: order.id, reason: result.pendingReason! });
      continue;
    }

    // v8.3 B.2.14/15: validar jornada del bloque propuesto (T_bloqueo D.3:
    // HHE/N + buffers 15+15+15). >10h = no se asigna solo; >8h = nota admin.
    const perPersonMinutes = Math.round(((hheHours / result.team.length) * 60) + 45);
    const workday = evaluateWorkday([{ serviceMinutes: perPersonMinutes, transitMinutes: 30 }]);
    if (workday.status === "blocked") {
      pendingLanguage.push(`${order.id}: workday_blocked (${workday.reasons.join("; ")})`);
      discrepancies.push({ orderId: order.id, reason: "workday_blocked" });
      continue;
    }

    const proposed = result.team;

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

  return { proposals, availableTeams, pendingLanguage, discrepancies };
}

/**
 * v8.3 E3 (B.2.12) — Registra las discrepancias de despacho detectadas en la
 * bandeja unificada (tickets_disputas, ya usada para esto exacto desde la
 * migración 080 — type='discrepancy' — no se inventa una tabla paralela) y
 * escala a prioridad alta las que llevan >=10 min abiertas sin respuesta del
 * admin (evaluateDispatchDiscrepancyFallback, la misma función pura testeada
 * en tests/lib/dispatch-fallback.test.ts).
 *
 * No auto-asigna nada al vencer el timer: ninguna de estas tres
 * discrepancias tiene una regla pre-aprobada segura que no viole B.2.13
 * (match de idioma) o el líder obligatorio — "decide con reglas
 * pre-aprobadas" aquí significa "sube la prioridad y lo deja logueado para
 * el admin", no "asigna a ciegas".
 */
async function recordAndEscalateDispatchDiscrepancies(
  supabase: ReturnType<typeof getSupabaseClient>,
  discrepancies: { orderId: string; reason: DispatchDiscrepancyReason }[]
): Promise<{ recorded: number; escalated: number }> {
  const nowIso = new Date().toISOString();
  let recorded = 0;

  for (const d of discrepancies) {
    const { data: existingTicket } = await supabase
      .from("tickets_disputas")
      .select("id")
      .eq("type", "discrepancy")
      .in("status", ["open", "escalated"])
      .contains("context", { order_id: d.orderId, reason: d.reason, source: "dispatch_scheduler" })
      .maybeSingle();

    if (!existingTicket) {
      const { error } = await supabase.from("tickets_disputas").insert({
        order_id: d.orderId,
        type: "discrepancy",
        priority: "medium",
        status: "open",
        context: { order_id: d.orderId, reason: d.reason, source: "dispatch_scheduler" },
      });
      if (!error) recorded += 1;
    }
  }

  // Fallback B.2.12: escalar tickets de despacho abiertos que llevan >=10 min.
  const { data: openTickets } = await supabase
    .from("tickets_disputas")
    .select("id, created_at, resolved_at, context")
    .eq("type", "discrepancy")
    .eq("status", "open");

  let escalated = 0;
  for (const t of openTickets || []) {
    const ctx = (t.context as Record<string, unknown>) || {};
    if (ctx.source !== "dispatch_scheduler") continue;

    const result = evaluateDispatchDiscrepancyFallback(
      t.created_at as string,
      nowIso,
      (t.resolved_at as string | null) ?? null
    );
    if (result.expired) {
      const { error } = await supabase
        .from("tickets_disputas")
        .update({ status: "escalated", priority: "high" })
        .eq("id", t.id);
      if (!error) escalated += 1;
    }
  }

  return { recorded, escalated };
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
      const { proposals, availableTeams, pendingLanguage, discrepancies } = await buildProposals(supabase, targetDate);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        notes: `Proposed ${proposals.filter((p) => p.proposedEmployeeIds.length > 0).length} orders` + (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : "") + (fallback.escalated ? ` | ESCALATED (B.2.12 10min): ${fallback.escalated}` : ""),
      });
      result = { ...result, proposals, availableTeams, pendingLanguage, fallback };
    }

    if (phase === "cutoff") {
      const { proposals, availableTeams, pendingLanguage, discrepancies } = await buildProposals(supabase, targetDate);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        notes: `Cutoff validation: ${proposals.filter((p) => p.proposedEmployeeIds.length > 0).length} orders ready` + (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : "") + (fallback.escalated ? ` | ESCALATED (B.2.12 10min): ${fallback.escalated}` : ""),
      });
      result = { ...result, proposals, availableTeams, pendingLanguage, fallback };
    }

    if (phase === "published") {
      const { proposals, availableTeams, pendingLanguage, discrepancies } = await buildProposals(supabase, targetDate);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
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
        notes: (autoApproved ? "Auto-approved (6+ teams available)" : "Published for manual review") + (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : ""),
      });
      result = { ...result, proposals, availableTeams, autoApproved, assigned, pendingLanguage };
    }

    if (phase === "simulation") {
      // Simulación 12:00 PM del día del servicio: detectar gaps y reasignar si es posible
      const today = getVancouverNow().toISOString().split("T")[0];
      const { proposals, availableTeams, pendingLanguage, discrepancies } = await buildProposals(supabase, today);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
      const unassigned = proposals.filter((p) => p.proposedEmployeeIds.length === 0);
      const assigned = await persistAssignments(supabase, proposals, true);
      await supabase.from("dispatch_runs").insert({
        run_date: today,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        orders_assigned: assigned,
        notes: `12PM simulation: ${unassigned.length} orders without team` + (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : "") + (fallback.escalated ? ` | ESCALATED (B.2.12 10min): ${fallback.escalated}` : ""),
      });
      result = { ...result, proposals, availableTeams, assigned, unassignedCount: unassigned.length, fallback };
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
        ? await supabase.from("assignments").select("order_id")
        .is("deleted_at", null).in("order_id", orderIds)
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

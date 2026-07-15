import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateTeamRequirements, getHHEForRange, type ServiceType } from "@/lib/pricing";
import { buildTeam, enforceMaxTeamSize, type DispatchCandidate } from "@/lib/dispatch-team";
import { evaluateWorkday } from "@/lib/workday";
import { isVehicleInsuranceExpired } from "@/lib/vehicle-insurance";
import { isEmployeeAssignableByCertification, type CertificationLevel } from "@/lib/certifications";
import { hasMinimumRestBetweenShifts } from "@/lib/shift-rest";
import {
  evaluateDispatchDiscrepancyFallback,
  type DispatchDiscrepancyReason,
} from "@/lib/dispatch-fallback";
import { evaluateTeamSixAutoApproval } from "@/lib/dispatch-approval";
import { publishUnifiedAlert } from "@/lib/unified-alerts";
import { evaluateOvertimeRejection } from "@/lib/schedule-7030";

/**
 * v8.3 ROUND 2 — hallazgo crítico de auditoría de flujo: este cron construía
 * su cliente Supabase con createServerClient + cookies() (mismo patrón que
 * una Route Handler con sesión de usuario), pero Vercel Cron invoca esta
 * ruta server-to-server con solo el header Authorization: Bearer
 * CRON_SECRET -- NUNCA hay cookies de sesión. Eso significa auth.uid()
 * evalúa NULL en Postgres, is_supervisor(NULL) es false, y las políticas
 * RLS "Supervisors manage assignments" (migración 003/017) y "Supervisors
 * insert tickets" (migración 010) BLOQUEAN silenciosamente cada
 * delete+insert de `assignments` y cada insert en `tickets_disputas` que
 * este cron intenta hacer. persistAssignments() nunca revisa el error de su
 * propio insert/delete más que para no incrementar el contador -- así que
 * el fallo era invisible: `assigned` se reportaba en 0 sin ningún error
 * visible, y la publicación automática de las 5:30 PM probablemente nunca
 * escribió una sola asignación real en producción.
 *
 * Mismo diagnóstico y mismo fix ya aplicado en wellbeing-chemical-reassign
 * (ver su comentario) y usado por batch-capture/batch-capture-retry: un
 * cron server-to-server debe autenticarse con SUPABASE_SERVICE_ROLE_KEY, no
 * con el cliente anon+cookies pensado para sesiones de navegador. La
 * protección sigue siendo el guard CRON_SECRET ya existente al inicio del
 * handler GET.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder";

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
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
      maxTeamSizeCorrections: [] as string[],
      overtimeRejectionNotices: [] as string[],
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

  // v8.3 E9.4/E7/D.9: certificación química vigente es requisito para ser
  // asignable ("no asignable sin vigencia") -- mismo patrón que el seguro
  // vehicular vencido arriba.
  const employeeIdsForCertCheck = (employees || []).map((e) => e.id);
  const certificationsByEmployee = new Map<
    string,
    { level: CertificationLevel; expiresAtISO: string; revokedAtISO: string | null }[]
  >();
  if (employeeIdsForCertCheck.length > 0) {
    const { data: certRows } = await supabase
      .from("employee_certifications")
      .select("employee_id, level, expires_at, revoked_at")
      .in("employee_id", employeeIdsForCertCheck);
    for (const c of certRows || []) {
      const list = certificationsByEmployee.get(c.employee_id) || [];
      list.push({
        level: c.level as CertificationLevel,
        expiresAtISO: c.expires_at,
        revokedAtISO: c.revoked_at,
      });
      certificationsByEmployee.set(c.employee_id, list);
    }
  }
  const nowIsoForCerts = new Date().toISOString();
  // Cláusula de transición: solo se bloquea a un empleado que YA tiene al
  // menos un registro de certificación (y todos vencidos/revocados). A un
  // empleado sin ningún registro histórico (la tabla employee_certifications
  // es nueva, migración 166) NO se le bloquea retroactivamente -- eso
  // detendría el despacho completo el día del despliegue sin haber
  // cargado datos reales. Una vez el admin registre certificaciones desde
  // /admin/certificaciones, el bloqueo real empieza a aplicar para ese
  // empleado. Ver src/lib/certifications.ts (la función pura sí trata
  // "sin registros" como no-asignable -- ese es el comportamiento correcto
  // en estado estable; aquí solo se amortigua el arranque en frío).
  const uncertifiedEmployeeIds = new Set(
    (employees || [])
      .filter((e) => {
        const records = certificationsByEmployee.get(e.id) || [];
        if (records.length === 0) return false;
        return !isEmployeeAssignableByCertification(records, nowIsoForCerts);
      })
      .map((e) => e.id)
  );

  // v8.3 (BC ESA s.32): mínimo 8h libres entre el fin de un turno y el
  // inicio del siguiente. Se compara contra el servicio MÁS TEMPRANO del
  // día objetivo (el peor caso -- si alcanza para ese, alcanza para
  // cualquier otro servicio más tarde ese mismo día).
  let restViolationEmployeeIds = new Set<string>();
  if (orders.length > 0 && (employees || []).length > 0) {
    const earliestServiceTime = orders.reduce(
      (min, o) => (o.service_time < min ? o.service_time : min),
      orders[0].service_time
    );
    const earliestServiceDatetime = `${targetDate}T${earliestServiceTime}`;

    const lookbackStart = new Date(new Date(earliestServiceDatetime).getTime() - 48 * 60 * 60 * 1000);
    const employeeIdsForRestCheck = (employees || []).map((e) => e.id);
    const { data: recentShiftEndLogs } = await supabase
      .from("service_logs")
      .select("employee_id, event_type, timestamp")
      .in("employee_id", employeeIdsForRestCheck)
      .in("event_type", ["jornada_end", "t_out"])
      .gte("timestamp", lookbackStart.toISOString())
      .lt("timestamp", earliestServiceDatetime)
      .order("timestamp", { ascending: false });

    const lastShiftEndByEmployee = new Map<string, string>();
    for (const log of recentShiftEndLogs || []) {
      if (!lastShiftEndByEmployee.has(log.employee_id)) {
        lastShiftEndByEmployee.set(log.employee_id, log.timestamp);
      }
    }

    restViolationEmployeeIds = new Set(
      (employees || [])
        .filter((e) => {
          const lastEnd = lastShiftEndByEmployee.get(e.id);
          if (!lastEnd) return false; // sin turno reciente registrado -- nada que violar
          return !hasMinimumRestBetweenShifts(lastEnd, earliestServiceDatetime).satisfiesMinimumRest;
        })
        .map((e) => e.id)
    );
  }

  // v8.3 FIX-5 (BC ESA Parte 5.1): un empleado con una ausencia por
  // enfermedad ya reportada (sick_leave_requests) para el targetDate NO debe
  // recibir un servicio nuevo ese día -- antes de este cambio, dispatch-
  // scheduler nunca consultaba esta tabla, así que reportar una ausencia no
  // impedía que el cron lo asignara igual al día siguiente. Mismo patrón de
  // exclusion-set que expiredInsuranceEmployeeIds/uncertifiedEmployeeIds.
  const employeeIdsForSickLeaveCheck = (employees || []).map((e) => e.id);
  let sickLeaveEmployeeIds = new Set<string>();
  if (employeeIdsForSickLeaveCheck.length > 0) {
    const { data: sickLeaveRows } = await supabase
      .from("sick_leave_requests")
      .select("employee_id")
      .in("employee_id", employeeIdsForSickLeaveCheck)
      .eq("absence_date", targetDate);
    sickLeaveEmployeeIds = new Set((sickLeaveRows || []).map((r) => r.employee_id));
  }

  const availableEmployees = (employees || []).filter(
    (e) =>
      e.is_active &&
      !expiredInsuranceEmployeeIds.has(e.id) &&
      !uncertifiedEmployeeIds.has(e.id) &&
      !restViolationEmployeeIds.has(e.id) &&
      !sickLeaveEmployeeIds.has(e.id)
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
  // v8.3 E3 (B.2.1): notas de corrección cuando enforceMaxTeamSize rechaza
  // un tamaño propuesto — no bloquean la orden, solo quedan logueadas.
  const maxTeamSizeCorrections: string[] = [];
  // v8.3 E3 (schedule-7030.ts, modelo 70/30) — jornada "completa" pero no
  // bloqueada (overtime_needs_approval): el equipo asignado tiene derecho a
  // rechazar el excedente sin penalización de score. No bloquea la orden
  // (a diferencia de "blocked"), pero deja registro explícito para que el
  // admin sepa que esta asignación requiere su aprobación y que el equipo
  // puede rechazarla -- evaluateOvertimeRejection ya existía testeada mas
  // nunca se llamaba desde ningún caller real.
  const overtimeRejectionNotices: string[] = [];

  if (expiredInsuranceEmployeeIds.size > 0) {
    pendingLanguage.push(
      `${expiredInsuranceEmployeeIds.size} empleado(s) excluido(s) del despacho: seguro de su vehículo vencido (v8.3 E7).`
    );
  }
  if (uncertifiedEmployeeIds.size > 0) {
    pendingLanguage.push(
      `${uncertifiedEmployeeIds.size} empleado(s) excluido(s) del despacho: sin certificación química vigente (v8.3 E9.4).`
    );
  }
  if (restViolationEmployeeIds.size > 0) {
    pendingLanguage.push(
      `${restViolationEmployeeIds.size} empleado(s) excluido(s) del despacho: no alcanzan las 8h de descanso mínimo entre turnos (BC ESA s.32).`
    );
  }
  if (sickLeaveEmployeeIds.size > 0) {
    pendingLanguage.push(
      `${sickLeaveEmployeeIds.size} empleado(s) excluido(s) del despacho: ausencia por enfermedad reportada para ${targetDate} (BC ESA Parte 5.1).`
    );
  }

  for (const order of orders || []) {
    const quote = quoteMap.get(order.quote_id);
    if (!quote) continue;

    const serviceType = quote.service_type as ServiceType;
    const squareFeet = quote.square_feet as number;
    const hheHours = getHHEForRange(serviceType, squareFeet);
    // v8.3 E7/known gap: este cron siempre pasa accountType="b2c" a
    // calculateTeamRequirements — no lee account_type de client_profiles
    // (existe en el schema, migración 001, pero no se consulta aquí). El
    // dispatch de órdenes B2B reales queda fuera de alcance de este cambio;
    // documentado para no inventar un comportamiento B2B no verificado.
    const { minTeams, maxTeams } = calculateTeamRequirements(serviceType, squareFeet, "b2c");
    const proposedTeamSize = Math.min(maxTeams, Math.max(minTeams, 1));

    // v8.3 E3 (B.2.1) — verificación de última línea antes de armar el
    // payload de despacho: N_max=3 en B2C residencial, nunca se sube N. La
    // señal "HHE requiere más tiempo" se aproxima igual que evaluateWorkday
    // más abajo (mismo cálculo de minutos por persona), evaluada aquí con el
    // tamaño propuesto para decidir si la corrección debe extender ventana.
    const prelimPerPersonMinutes = Math.round(((hheHours / proposedTeamSize) * 60) + 45);
    const prelimWorkday = evaluateWorkday([{ serviceMinutes: prelimPerPersonMinutes, transitMinutes: 30 }]);
    const sizeCheck = enforceMaxTeamSize(
      "b2c_residential",
      proposedTeamSize,
      prelimWorkday.status !== "ok"
    );
    if (!sizeCheck.valid) {
      maxTeamSizeCorrections.push(`${order.id}: ${sizeCheck.reason}`);
    }
    const teamSize = sizeCheck.correctedSize;

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

    if (workday.status === "overtime_needs_approval") {
      const overtimeDecision = evaluateOvertimeRejection(workday.status);
      overtimeRejectionNotices.push(
        `${order.id}: ${overtimeDecision.reason} (equipo: ${result.team.map((e) => e.id).join(", ")})`
      );
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

  return { proposals, availableTeams, pendingLanguage, discrepancies, maxTeamSizeCorrections, overtimeRejectionNotices };
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
      if (!error) {
        escalated += 1;
        // v8.3 E0.6: bandeja unificada. La discrepancia de despacho llevaba
        // >=10 min sin resolverse (B.2.12) — entra a la bandeja como
        // respond_10min ya vencido, para visibilidad inmediata.
        await publishUnifiedAlert(supabase, {
          sourceModule: "dispatch_discrepancy",
          sourceTable: "tickets_disputas",
          sourceId: t.id as string,
          tier: "respond_10min",
          severity: "p1_urgent",
          title: `Discrepancia de despacho escalada: ${(ctx.reason as string) ?? "sin razón"}`,
          summary: `Orden ${ctx.order_id ?? "desconocida"} — sin resolución tras 10 min.`,
        });
      }
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
  let skippedLocked = 0;
  for (const p of proposals) {
    if (p.proposedEmployeeIds.length === 0) continue;

    // v8.3 E3/D.4 (migración 140): un admin ya revisó y asignó esta orden
    // manualmente durante la ventana 5:00-5:30 PM (POST /api/admin/dispatch
    // marca locked_by_admin=true) -- la decisión humana gana siempre, el
    // publicador automático NO debe borrarla ni reemplazarla.
    const { data: lockedRows } = await supabase
      .from("assignments")
      .select("id")
      .eq("order_id", p.orderId)
      .eq("locked_by_admin", true)
      .limit(1);

    if (lockedRows && lockedRows.length > 0) {
      skippedLocked++;
      continue;
    }

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
  return { assigned, skippedLocked };
}

// GET /api/cron/dispatch-scheduler
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
  if (cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service credentials not configured" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseClient();
  const phase = detectPhase();
  const targetDate = getTomorrowDate();

  try {
    let result: Record<string, unknown> = { phase, targetDate };

    if (phase === "proposal") {
      const { proposals, availableTeams, pendingLanguage, discrepancies, maxTeamSizeCorrections, overtimeRejectionNotices } =
        await buildProposals(supabase, targetDate);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        notes: `Proposed ${proposals.filter((p) => p.proposedEmployeeIds.length > 0).length} orders` + (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : "") + (fallback.escalated ? ` | ESCALATED (B.2.12 10min): ${fallback.escalated}` : "") + (maxTeamSizeCorrections.length ? ` | N_MAX_ENFORCED (B.2.1): ${maxTeamSizeCorrections.join("; ")}` : "") + (overtimeRejectionNotices.length ? ` | OVERTIME_REJECTION_RIGHT (E3 70/30): ${overtimeRejectionNotices.join("; ")}` : ""),
      });
      result = { ...result, proposals, availableTeams, pendingLanguage, fallback, maxTeamSizeCorrections, overtimeRejectionNotices };
    }

    if (phase === "cutoff") {
      const { proposals, availableTeams, pendingLanguage, discrepancies, maxTeamSizeCorrections, overtimeRejectionNotices } =
        await buildProposals(supabase, targetDate);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        notes: `Cutoff validation: ${proposals.filter((p) => p.proposedEmployeeIds.length > 0).length} orders ready` + (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : "") + (fallback.escalated ? ` | ESCALATED (B.2.12 10min): ${fallback.escalated}` : "") + (maxTeamSizeCorrections.length ? ` | N_MAX_ENFORCED (B.2.1): ${maxTeamSizeCorrections.join("; ")}` : "") + (overtimeRejectionNotices.length ? ` | OVERTIME_REJECTION_RIGHT (E3 70/30): ${overtimeRejectionNotices.join("; ")}` : ""),
      });
      result = { ...result, proposals, availableTeams, pendingLanguage, fallback, maxTeamSizeCorrections, overtimeRejectionNotices };
    }

    if (phase === "published") {
      const { proposals, availableTeams, pendingLanguage, discrepancies, maxTeamSizeCorrections, overtimeRejectionNotices } =
        await buildProposals(supabase, targetDate);
      const fallback = await recordAndEscalateDispatchDiscrepancies(supabase, discrepancies);
      // v8.3 E3 (D.4/E2#9) — umbral "equipo #6": ver nota de alcance en
      // dispatch-approval.ts sobre por qué `hasRedAlerts` usa discrepancias
      // + correcciones de N_max como proxy (no existe todavía el semáforo de
      // tránsito real de la matriz drag-and-drop, marcada WIREFRAME).
      const hasRedAlerts = discrepancies.length > 0 || maxTeamSizeCorrections.length > 0;
      const approval = evaluateTeamSixAutoApproval(availableTeams, hasRedAlerts);
      const autoApproved = approval.autoApproveDefault;
      const { assigned, skippedLocked } = await persistAssignments(supabase, proposals, autoApproved);
      await supabase.from("dispatch_runs").insert({
        run_date: targetDate,
        phase,
        auto_approved: autoApproved,
        teams_available: availableTeams,
        orders_processed: proposals.length,
        orders_assigned: assigned,
        notes:
          (approval.teamSixActive
            ? autoApproved
              ? "Auto-approved (equipo #6 activo, sin alertas rojas)"
              : "Equipo #6 activo pero HAY alertas rojas: publicado para revisión manual"
            : "Published for manual review") +
          (approval.showDelegationReminder ? " | Recordatorio de delegación: considerar coordinador" : "") +
          (pendingLanguage.length ? ` | PENDING (leader/language): ${pendingLanguage.join("; ")}` : "") +
          (maxTeamSizeCorrections.length ? ` | N_MAX_ENFORCED (B.2.1): ${maxTeamSizeCorrections.join("; ")}` : "") +
          (overtimeRejectionNotices.length ? ` | OVERTIME_REJECTION_RIGHT (E3 70/30): ${overtimeRejectionNotices.join("; ")}` : "") +
          (skippedLocked > 0 ? ` | ADMIN_OVERRIDE_PRESERVED (D.4): ${skippedLocked} orden(es) ya asignada(s) manualmente, no tocadas` : ""),
      });
      result = {
        ...result,
        proposals,
        availableTeams,
        overtimeRejectionNotices,
        autoApproved,
        showDelegationReminder: approval.showDelegationReminder,
        assigned,
        pendingLanguage,
        maxTeamSizeCorrections,
      };
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
      // Fallback de crisis: reasignar órdenes del día sin equipo con cualquier empleado disponible.
      //
      // v8.3 fix (auditoría 2026-07-15): esta rama corre en la enorme mayoría
      // de los ~96 disparos diarios del cron (cualquier hora fuera de las 4
      // ventanas de 15 min de proposal/cutoff/published/simulation cae aquí).
      // Antes: (a) usaba `find(() => true)`, que SIEMPRE devuelve el PRIMER
      // empleado de la lista sin filtrar nada -- un solo empleado terminaba
      // asignado a TODAS las órdenes sin equipo de una corrida, sin importar
      // cuántas fueran ni si ya tenía otra asignación esa hora; y (b) no
      // validaba certificación química, seguro vehicular vigente ni descanso
      // mínimo 8h (BC ESA s.32) -- invariantes duras que sí se aplican en
      // buildProposals(). Cualquier orden sin líder/idioma (pendingLanguage)
      // quedaba sin fila en `assignments`, así que el siguiente ciclo de
      // crisis_fallback (minutos después) la "recuperaba" saltándose esas
      // reglas otra vez.
      //
      // Fix: reutiliza las mismas listas de exclusión que el flujo normal
      // (seguro, certificación, descanso, enfermedad) y reparte round-robin
      // entre empleados DISTINTOS, evitando asignar dos veces al mismo
      // empleado en la misma corrida y evitando empleados que ya tienen otra
      // asignación activa hoy.
      const today = getVancouverNow().toISOString().split("T")[0];
      const { data: unassignedOrders } = await supabase
        .from("orders")
        .select("id, service_time")
        .eq("service_date", today)
        .neq("status", "cancelled")
        .neq("status", "completed");

      const orderIds = (unassignedOrders || []).map((o) => o.id);
      const { data: existingAssignments } = orderIds.length > 0
        ? await supabase.from("assignments").select("order_id, employee_id")
        .is("deleted_at", null).not("status", "eq", "cancelled").in("order_id", orderIds)
        : { data: [] };

      const assignedOrderIds = new Set((existingAssignments || []).map((a) => a.order_id));
      const crisisOrders = (unassignedOrders || []).filter((o) => !assignedOrderIds.has(o.id));

      // Empleados que YA tienen una asignación activa hoy (en cualquier otra
      // orden) no deben recibir una segunda vía crisis_fallback -- evita
      // doble-reserva del mismo empleado en horarios que se solapan.
      const employeesAlreadyAssignedToday = new Set(
        (existingAssignments || []).map((a) => a.employee_id).filter((id): id is string => !!id)
      );

      const { data: allActiveEmployees } = await supabase
        .from("employees")
        .select("id, vehicle_id")
        .eq("is_active", true)
        .in("role", ["cleaner", "supervisor"]);

      const crisisEmployeeIds = (allActiveEmployees || []).map((e) => e.id);

      // Enfermedad (BC ESA Parte 5.1) -- ya existía.
      let crisisSickLeaveEmployeeIds = new Set<string>();
      if (crisisEmployeeIds.length > 0) {
        const { data: crisisSickLeaveRows } = await supabase
          .from("sick_leave_requests")
          .select("employee_id")
          .in("employee_id", crisisEmployeeIds)
          .eq("absence_date", today);
        crisisSickLeaveEmployeeIds = new Set((crisisSickLeaveRows || []).map((r) => r.employee_id));
      }

      // Seguro vehicular vencido (v8.3 E7) -- mismo criterio que buildProposals.
      const crisisVehicleIds = Array.from(
        new Set((allActiveEmployees || []).map((e) => e.vehicle_id).filter((v): v is string => !!v))
      );
      const crisisVehicleInsuranceExpiryById = new Map<string, string | null>();
      if (crisisVehicleIds.length > 0) {
        const { data: crisisVehicles } = await supabase
          .from("vehicles")
          .select("id, insurance_expiry_date")
          .in("id", crisisVehicleIds);
        for (const v of crisisVehicles || []) {
          crisisVehicleInsuranceExpiryById.set(v.id, v.insurance_expiry_date as string | null);
        }
      }
      const crisisExpiredInsuranceEmployeeIds = new Set(
        (allActiveEmployees || [])
          .filter((e) => e.vehicle_id && isVehicleInsuranceExpired(crisisVehicleInsuranceExpiryById.get(e.vehicle_id) ?? null, today))
          .map((e) => e.id)
      );

      // Certificación química vigente (v8.3 E9.4) -- mismo criterio y misma
      // cláusula de transición (sin registros = no bloqueado retroactivo).
      let crisisUncertifiedEmployeeIds = new Set<string>();
      if (crisisEmployeeIds.length > 0) {
        const { data: crisisCertRows } = await supabase
          .from("employee_certifications")
          .select("employee_id, level, expires_at, revoked_at")
          .in("employee_id", crisisEmployeeIds);
        const crisisCertsByEmployee = new Map<
          string,
          { level: CertificationLevel; expiresAtISO: string; revokedAtISO: string | null }[]
        >();
        for (const c of crisisCertRows || []) {
          const list = crisisCertsByEmployee.get(c.employee_id) || [];
          list.push({
            level: c.level as CertificationLevel,
            expiresAtISO: c.expires_at,
            revokedAtISO: c.revoked_at,
          });
          crisisCertsByEmployee.set(c.employee_id, list);
        }
        const crisisNowIso = new Date().toISOString();
        crisisUncertifiedEmployeeIds = new Set(
          (allActiveEmployees || [])
            .filter((e) => {
              const records = crisisCertsByEmployee.get(e.id) || [];
              if (records.length === 0) return false;
              return !isEmployeeAssignableByCertification(records, crisisNowIso);
            })
            .map((e) => e.id)
        );
      }

      // Descanso mínimo 8h entre turnos (BC ESA s.32) -- contra la orden más
      // temprana sin cubrir de esta corrida (peor caso).
      let crisisRestViolationEmployeeIds = new Set<string>();
      if (crisisOrders.length > 0 && crisisEmployeeIds.length > 0) {
        const earliestServiceTime = crisisOrders.reduce(
          (min, o) => (o.service_time < min ? o.service_time : min),
          crisisOrders[0].service_time
        );
        const earliestServiceDatetime = `${today}T${earliestServiceTime}`;
        const lookbackStart = new Date(new Date(earliestServiceDatetime).getTime() - 48 * 60 * 60 * 1000);
        const { data: crisisRecentShiftEndLogs } = await supabase
          .from("service_logs")
          .select("employee_id, timestamp")
          .in("employee_id", crisisEmployeeIds)
          .in("event_type", ["jornada_end", "t_out"])
          .gte("timestamp", lookbackStart.toISOString())
          .lt("timestamp", earliestServiceDatetime)
          .order("timestamp", { ascending: false });
        const crisisLastShiftEndByEmployee = new Map<string, string>();
        for (const log of crisisRecentShiftEndLogs || []) {
          if (!crisisLastShiftEndByEmployee.has(log.employee_id)) {
            crisisLastShiftEndByEmployee.set(log.employee_id, log.timestamp);
          }
        }
        crisisRestViolationEmployeeIds = new Set(
          (allActiveEmployees || [])
            .filter((e) => {
              const lastEnd = crisisLastShiftEndByEmployee.get(e.id);
              if (!lastEnd) return false;
              return !hasMinimumRestBetweenShifts(lastEnd, earliestServiceDatetime).satisfiesMinimumRest;
            })
            .map((e) => e.id)
        );
      }

      const availableEmployees = (allActiveEmployees || []).filter(
        (e) =>
          !crisisSickLeaveEmployeeIds.has(e.id) &&
          !crisisExpiredInsuranceEmployeeIds.has(e.id) &&
          !crisisUncertifiedEmployeeIds.has(e.id) &&
          !crisisRestViolationEmployeeIds.has(e.id) &&
          !employeesAlreadyAssignedToday.has(e.id)
      );

      // Round-robin: nunca repetir el mismo empleado dos veces en esta
      // corrida (a diferencia de find(() => true), que siempre devolvía el
      // primero). Si se agotan los empleados disponibles, las órdenes
      // restantes quedan sin cubrir -- correcto: mejor sin cubrir (visible,
      // escalable) que doble-reservado (invisible, peligroso).
      const usedThisRun = new Set<string>();
      let recovered = 0;
      const stillUncovered: string[] = [];
      for (const o of crisisOrders) {
        const emp = availableEmployees.find((e) => !usedThisRun.has(e.id));
        if (!emp) {
          stillUncovered.push(o.id);
          continue;
        }
        usedThisRun.add(emp.id);
        const { error } = await supabase.from("assignments").insert({
          order_id: o.id,
          employee_id: emp.id,
          status: "pending",
          notes: "Crisis fallback assignment",
        });
        if (!error) recovered += 1;
        else stillUncovered.push(o.id);
      }

      await supabase.from("dispatch_runs").insert({
        run_date: today,
        phase,
        teams_available: availableEmployees.length,
        orders_processed: crisisOrders.length,
        orders_assigned: recovered,
        notes:
          `Crisis fallback recovered ${recovered} orders` +
          (stillUncovered.length ? ` | STILL_UNCOVERED (no safe employee available): ${stillUncovered.join(", ")}` : ""),
      });
      result = { ...result, crisisOrders: crisisOrders.length, recovered, stillUncovered: stillUncovered.length };
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Dispatch scheduler error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

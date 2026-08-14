
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { createRouteSupabaseClient } from "@/lib/supabase-server";
import { getVancouverTodayString } from "@/lib/date-utils";
import { safeErrorResponse } from "@/lib/api-errors";
const RECENT_TEAMMATE_DAYS = 14;

/**
 * Compañeros con los que `employeeId` compartió una asignación real
 * (misma orden, `assignments.order_id`) en los últimos RECENT_TEAMMATE_DAYS
 * días de `orders.service_date`. Mismo patrón de "co-asignados en las
 * mismas órdenes" que ya usan team-chat/route.ts y ritual/inicio/route.ts —
 * se reutiliza aquí para que la votación de bienestar solo pueda dirigirse
 * a compañeros con los que de verdad se trabajó recientemente.
 */
async function getRecentTeammateIds(
  supabase: Awaited<ReturnType<typeof createRouteSupabaseClient>>,
  employeeId: string
): Promise<Set<string>> {
  const todayStr = getVancouverTodayString();
  const sinceStr = new Date(Date.now() - RECENT_TEAMMATE_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const { data: recentOrders } = await supabase
    .from("orders")
    .select("id")
    .gte("service_date", sinceStr)
    .lte("service_date", todayStr);

  const recentOrderIds = (recentOrders || []).map((o) => o.id);
  if (recentOrderIds.length === 0) return new Set();

  const { data: myAssignments } = await supabase
    .from("assignments")
    .select("order_id")
    .eq("employee_id", employeeId)
    .is("deleted_at", null)
    .in("order_id", recentOrderIds);

  const myOrderIds = (myAssignments || []).map((a) => a.order_id);
  if (myOrderIds.length === 0) return new Set();

  const { data: coAssignments } = await supabase
    .from("assignments")
    .select("employee_id")
    .in("order_id", myOrderIds)
    .neq("employee_id", employeeId)
    .is("deleted_at", null);

  return new Set((coAssignments || []).map((a) => a.employee_id));
}

// GET /api/employee/voting — compañeros para votar esta semana
export async function GET() {
  try {
    const supabase = await createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee: me, error: meError, status: meStatus } = await requireActiveEmployee(supabase, user.id);

    if (!me) {
      return NextResponse.json({ error: meError }, { status: meStatus });
    }

    // v8.3 auditoría 2026-07-21 (D-P1-6): `getDate() - getDay() + 1` manda
    // el domingo a la semana SIGUIENTE en vez de a la que acaba de
    // terminar (getDay()===0 no se maneja como caso especial), permitiendo
    // hasta 3 votos al mismo compañero en 8 días. Mismo patrón correcto
    // que ya usa empleado/ritual/inicio/route.ts:27-33.
    const vancouverDateStr = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0];
    const vancouverToday = new Date(vancouverDateStr + "T12:00:00Z");
    const day = vancouverToday.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(vancouverToday);
    monday.setUTCDate(vancouverToday.getUTCDate() - diff);
    const weekStart = monday.toISOString().split("T")[0];

    // Auditoría externa (verificado real): este GET devolvía TODOS los
    // empleados activos como "compañeros votables", sin exigir que hubieran
    // trabajado juntos recientemente. Eso permite votar (bien o mal) a
    // alguien con quien nunca se compartió turno/orden, lo que vuelve el
    // ranking de bienestar manipulable. Se restringe a compañeros reales:
    // co-asignados en las mismas órdenes en los últimos RECENT_TEAMMATE_DAYS
    // días (mismo patrón "assignments" + "orders.service_date" que ya usan
    // team-chat/route.ts y ritual/inicio/route.ts).
    const teammateIds = await getRecentTeammateIds(supabase, me.id);

    if (teammateIds.size === 0) {
      return NextResponse.json({ peers: [], weekStart }, { status: 200 });
    }

    const { data: peers, error: peersError } = await supabase
      .from("employees")
      .select("id, name, role")
      .eq("is_active", true)
      .is("deleted_at", null)
      .neq("id", me.id)
      .in("id", Array.from(teammateIds));

    if (peersError) {
      console.error("peersError:", peersError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // Votos ya emitidos esta semana
    const { data: myVotes, error: votesError } = await supabase
      .from("peer_votes")
      .select("target_employee_id, rating")
      .eq("voter_employee_id", me.id)
      .eq("week_start", weekStart);

    if (votesError) {
      console.error("votesError:", votesError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const votedSet = new Set((myVotes || []).map((v) => v.target_employee_id));

    const result = (peers || []).map((p) => ({
      ...p,
      alreadyVoted: votedSet.has(p.id),
      myRating: myVotes?.find((v) => v.target_employee_id === p.id)?.rating || null,
    }));

    return NextResponse.json({ peers: result, weekStart }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

// POST /api/employee/voting — enviar voto
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { employee: me, error: meError, status: meStatus } = await requireActiveEmployee(supabase, user.id);

    if (!me) {
      return NextResponse.json({ error: meError }, { status: meStatus });
    }

    const body = await request.json();
    const { targetEmployeeId, rating, note } = body;

    if (!targetEmployeeId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Invalid vote" }, { status: 400 });
    }

    if (targetEmployeeId === me.id) {
      return NextResponse.json({ error: "Cannot vote for yourself" }, { status: 400 });
    }

    // Fix Kimi-A9 (auditoría externa Kimi Code, 2026-07-21, verificado y
    // confirmado real): este POST tenía su PROPIO cálculo de "lunes de esta
    // semana", distinto del que ya se corrigió en el GET de este mismo
    // archivo (fix D-P1-6, más arriba en este mismo día de auditoría) --
    // `getDate() - getDay() + 1` manda el domingo a la semana SIGUIENTE
    // (getDay()===0 sin caso especial), permitiendo votar hasta 3 veces al
    // mismo compañero en 8 días si alguno de los votos cae en domingo. Se
    // alinea con el cálculo ya corregido del GET (mismo patrón exacto que
    // empleado/ritual/inicio/route.ts).
    const vancouverDateStr = new Date().toLocaleString("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).split(",")[0];
    const vancouverToday = new Date(vancouverDateStr + "T12:00:00Z");
    const day = vancouverToday.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(vancouverToday);
    monday.setUTCDate(vancouverToday.getUTCDate() - diff);
    const weekStart = monday.toISOString().split("T")[0];

    // Verificar si ya votó por este compañero esta semana
    const { data: existingVote, error: checkError } = await supabase
      .from("peer_votes")
      .select("id")
      .eq("voter_employee_id", me.id)
      .eq("target_employee_id", targetEmployeeId)
      .eq("week_start", weekStart)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("checkError:", checkError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (existingVote) {
      return NextResponse.json({ error: "Already voted for this peer this week" }, { status: 409 });
    }

    // Verificar que el target existe y es activo
    const { data: targetEmployee, error: targetError } = await supabase
      .from("employees")
      .select("id")
      .eq("id", targetEmployeeId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .single();

    if (targetError || !targetEmployee) {
      return NextResponse.json({ error: "Target employee not found or inactive" }, { status: 400 });
    }

    // Auditoría externa (verificado real): el POST solo comprobaba que el
    // target existiera y estuviera activo, no que fuera un compañero real
    // (mismo problema que en el GET, arriba en este archivo). Sin este
    // check, el filtrado del GET era solo cosmético: cualquiera podía votar
    // por cualquier employeeId activo llamando al POST directamente.
    const teammateIds = await getRecentTeammateIds(supabase, me.id);
    if (!teammateIds.has(targetEmployeeId)) {
      return NextResponse.json(
        { error: "Solo puedes votar por compañeros con los que trabajaste recientemente" },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from("peer_votes")
      .insert({
        voter_employee_id: me.id,
        target_employee_id: targetEmployeeId,
        week_start: weekStart,
        rating,
        note: note || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ vote: data }, { status: 201 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

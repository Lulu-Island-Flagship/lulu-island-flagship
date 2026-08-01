import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";

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

// GET /api/empleado/votacion — compañeros para votar esta semana
export async function GET() {
  try {
    const supabase = getSupabaseClient();
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

    // Compañeros activos (excluyendo uno mismo)
    const { data: peers, error: peersError } = await supabase
      .from("employees")
      .select("id, name, role")
      .eq("is_active", true)
      .is("deleted_at", null)
      .neq("id", me.id);

    if (peersError) {
      return NextResponse.json({ error: peersError.message }, { status: 500 });
    }

    // Votos ya emitidos esta semana
    const { data: myVotes, error: votesError } = await supabase
      .from("peer_votes")
      .select("target_employee_id, rating")
      .eq("voter_employee_id", me.id)
      .eq("week_start", weekStart);

    if (votesError) {
      return NextResponse.json({ error: votesError.message }, { status: 500 });
    }

    const votedSet = new Set((myVotes || []).map((v) => v.target_employee_id));

    const result = (peers || []).map((p) => ({
      ...p,
      alreadyVoted: votedSet.has(p.id),
      myRating: myVotes?.find((v) => v.target_employee_id === p.id)?.rating || null,
    }));

    return NextResponse.json({ peers: result, weekStart }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/empleado/votacion — enviar voto
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
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
      return NextResponse.json({ error: checkError.message }, { status: 500 });
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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ vote: data }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

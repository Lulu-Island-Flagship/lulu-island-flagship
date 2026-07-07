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

// GET /api/empleado/votacion — compañeros para votar esta semana
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: me, error: meError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (meError || !me) {
      return NextResponse.json({ error: "Employee not found" }, { status: 403 });
    }

    // Lunes de esta semana
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
    const weekStart = monday.toISOString().split("T")[0];

    // Compañeros activos (excluyendo uno mismo)
    const { data: peers, error: peersError } = await supabase
      .from("employees")
      .select("id, name, role")
      .eq("is_active", true)
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

    const { data: me, error: meError } = await supabase
      .from("employees")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (meError || !me) {
      return NextResponse.json({ error: "Employee not found" }, { status: 403 });
    }

    const body = await request.json();
    const { targetEmployeeId, rating, note } = body;

    if (!targetEmployeeId || !rating || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Invalid vote" }, { status: 400 });
    }

    if (targetEmployeeId === me.id) {
      return NextResponse.json({ error: "Cannot vote for yourself" }, { status: 400 });
    }

    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);
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

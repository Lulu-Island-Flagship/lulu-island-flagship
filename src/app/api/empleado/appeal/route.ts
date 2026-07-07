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

// POST /api/empleado/appeal — enviar apelación de una evaluación de auditor
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
    const { auditId, reason } = body;

    if (!auditId || !reason || !reason.trim()) {
      return NextResponse.json({ error: "Missing auditId or reason" }, { status: 400 });
    }

    // Verificar que la evaluación existe y pertenece al empleado
    const { data: audit, error: auditError } = await supabase
      .from("field_audits")
      .select("id, employee_id, created_at, appealed_at")
      .eq("id", auditId)
      .single();

    if (auditError || !audit) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (audit.employee_id !== me.id) {
      return NextResponse.json({ error: "Cannot appeal an audit that is not yours" }, { status: 403 });
    }

    if (audit.appealed_at) {
      return NextResponse.json({ error: "Already appealed" }, { status: 409 });
    }

    // Ventana de 72h para apelar
    const auditDate = new Date(audit.created_at);
    const now = new Date();
    const hoursSince = (now.getTime() - auditDate.getTime()) / (1000 * 60 * 60);
    if (hoursSince > 72) {
      return NextResponse.json({ error: "Appeal window expired (72h)" }, { status: 410 });
    }

    const { data, error } = await supabase
      .from("field_audits")
      .update({
        appealed_at: now.toISOString(),
        appeal_reason: reason.trim(),
      })
      .eq("id", auditId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ appeal: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

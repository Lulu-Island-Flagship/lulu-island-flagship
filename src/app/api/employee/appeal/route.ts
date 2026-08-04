import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase-server";
import { safeErrorResponse } from "@/lib/api-errors";

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    getSupabaseUrl(),
    getSupabaseAnonKey(),
    {
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
    }
  );
}

// POST /api/employee/appeal — enviar apelación de una evaluación de auditor
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

    // v8.3 E5 (auditoría 2026-07-18, migración 191) — bug real: esta ruta
    // usaba 72h como VENTANA DEL EMPLEADO para apelar, bloqueando la
    // apelación con 410 si pasaban. Pero 72h es el PLAZO DEL ADMIN para
    // RESOLVER una apelación ya presentada (no un plazo para presentarla).
    // No hay ninguna especificación de un plazo de presentación distinto,
    // así que se elimina el bloqueo por antigüedad de la auditoría -- el
    // empleado puede apelar mientras la auditoría siga sin resolver
    // (appealed_at null) -- y en su lugar se fija appeal_deadline como el
    // plazo del admin para resolver, con alerta si se acerca/vence
    // (ver /api/cron/appeal-deadline-check).
    const now = new Date();
    const appealDeadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("field_audits")
      .update({
        appealed_at: now.toISOString(),
        appeal_reason: reason.trim(),
        appeal_deadline: appealDeadline.toISOString(),
      })
      .eq("id", auditId)
      .select()
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ appeal: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

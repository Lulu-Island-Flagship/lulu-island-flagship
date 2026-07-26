import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveEmployee } from "@/lib/require-active-employee";

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

/**
 * POST /api/empleado/qc/[orderId]/resubmit
 *
 * v8.3 E5 (auditoría 2026-07-18, migración 190) — cierra el flujo de
 * 'rework': el empleado corrigió lo pedido (nueva foto, tarea completada) y
 * marca el servicio como listo para que el admin lo vuelva a revisar.
 * Vuelve a 'pending' -- NUNCA se auto-aprueba a sí mismo desde acá, siempre
 * pasa de nuevo por el muro QC humano. Si ya venció el timer de 30 min
 * (rework_deadline), el cron qc-rework-expiry ya lo habrá pasado a
 * 'rejected' y esta ruta lo rechaza con 410.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
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

    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note.trim() : null;

    const { data: review, error: reviewError } = await supabase
      .from("qc_reviews")
      .select("id, employee_id, status, rework_deadline")
      .eq("order_id", orderId)
      .single();

    if (reviewError || !review) {
      return NextResponse.json({ error: "QC review not found" }, { status: 404 });
    }

    if (review.employee_id !== me.id) {
      return NextResponse.json({ error: "Cannot resubmit a review that is not yours" }, { status: 403 });
    }

    if (review.status !== "rework") {
      return NextResponse.json({ error: "Review is not in rework state" }, { status: 409 });
    }

    if (review.rework_deadline && new Date(review.rework_deadline).getTime() < Date.now()) {
      return NextResponse.json({ error: "Rework window expired (30 min)" }, { status: 410 });
    }

    const { data, error } = await supabase
      .from("qc_reviews")
      .update({
        status: "pending",
        rework_resubmitted_at: new Date().toISOString(),
        note: note ? `Resubmitido por empleado: ${note}` : "Resubmitido por empleado",
      })
      .eq("order_id", orderId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ review: data }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

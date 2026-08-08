import { NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/admin/upsells/[id]/review — marcar upsell como revisado.
 *
 * v8.3 FIX-6 (B.5): "tope: upsell ≤50% del valor base sin aprobación admin".
 * reviewed_by_admin (migración 007) es un check-off genérico de "un admin lo
 * vio", pero no era una compuerta real -- un upsell por encima del tope se
 * podía comisionar igual sin que nadie lo aprobara explícitamente. Ahora
 * POST /api/employee/upsells marca approval_status='pending_admin_approval'
 * cuando el acumulado de la orden supera el 50% de quotes.total (migración
 * 175); este endpoint es la compuerta real: approve/reject. Se mantiene
 * reviewed_by_admin=true en ambos casos por compatibilidad con paneles que
 * ya filtran por esa columna.
 *
 * Body (opcional): { action?: "approve" | "reject", reason?: string }
 * Sin body / sin action → comportamiento legado (solo marca reviewed_by_admin).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("upsells_review");
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "upsells_review", method: "POST", path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const { id } = await params;
    const supabase = auth.supabase;
    const userId = auth.user.id;

    let action: "approve" | "reject" | undefined;
    let reason: string | undefined;
    try {
      const body = await request.json();
      action = body?.action;
      reason = body?.reason;
    } catch {
      // sin body: comportamiento legado
    }

    const { data: existing, error: existingError } = await supabase
      .from("service_upsells")
      .select("id, order_id, approval_status")
      .eq("id", id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json({ error: "Upsell not found" }, { status: 404 });
    }

    const update: Record<string, unknown> = { reviewed_by_admin: true };

    if (action === "approve" || action === "reject") {
      if (existing.approval_status !== "pending_admin_approval") {
        return NextResponse.json(
          { error: "Upsell does not require admin approval" },
          { status: 409 }
        );
      }
      update.approval_status = action === "approve" ? "admin_approved" : "admin_rejected";
      update.approved_by = userId;
      update.approved_at = new Date().toISOString();
      update.rejection_reason = action === "reject" ? reason || "Rejected by admin" : null;
      // v8.3 auditoría 2026-07-21 (E-A4): client_approved se leía en dos
      // sitios (pantalla de cierre de jornada / cálculo de comisión) pero
      // nunca se escribía en ningún endpoint -- la comisión del líder
      // sobre un upsell aprobado por el admin siempre mostraba $0. La
      // aprobación del admin ES la confirmación de que el upsell es
      // válido y cobrable; el rechazo debe dejarlo en false.
      update.client_approved = action === "approve";
    }

    // Fix (pentest Kimi, race condition operativa #5): el chequeo
    // `existing.approval_status !== "pending_admin_approval"` de arriba se
    // lee de un SELECT hecho ANTES de este UPDATE -- dos POST concurrentes
    // de approve/reject sobre el mismo upsell ambos pasaban ese chequeo (los
    // dos veían "pending_admin_approval" todavía) y ambos escribían aquí: el
    // segundo pisaba silenciosamente la decisión del primero (ej. un
    // "approve" seguido de un "reject" concurrente podía dejar
    // client_approved=false sobre un upsell que ya se había comisionado como
    // aprobado, o viceversa). Se agrega `.eq("approval_status",
    // "pending_admin_approval")` cuando la acción es approve/reject como
    // compare-and-swap real: solo el primer UPDATE concurrente afecta una
    // fila; el segundo no matchea ninguna (el estado ya cambió) y `data`
    // vuelve null -> se responde 409 en vez de pisar la revisión ya hecha.
    let query = supabase.from("service_upsells").update(update).eq("id", id);
    if (action === "approve" || action === "reject") {
      query = query.eq("approval_status", "pending_admin_approval");
    }
    const { data, error } = await query.select().maybeSingle();

    if (error) {
      console.error("Upsell review error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: "Upsell does not require admin approval" },
        { status: 409 }
      );
    }

    if (action === "approve" || action === "reject") {
      await supabase
        .from("tickets_disputas")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("type", "upsell_approval")
        .eq("order_id", existing.order_id)
        .contains("context", { upsell_id: id })
        .eq("status", "open");
    }

    return NextResponse.json({ success: true, upsell: data }, { status: 200 });
  } catch (err: Error | unknown) {
    return safeErrorResponse(err);
  }
}

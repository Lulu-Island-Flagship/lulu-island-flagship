import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";
import { dispatchCommunication } from "@/lib/send-communication";
import { safeErrorResponse } from "@/lib/api-errors";
import { isValidUuid } from "@/lib/validation";

// POST /api/admin/tickets/[id]/resolve — resolver ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "tickets", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  try {
    const { id } = await params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    const body = await request.json();
    const { resolutionNote, status } = body;

    if (!resolutionNote || !status) {
      return NextResponse.json({ error: "Resolution note and status required" }, { status: 400 });
    }

    if (!["resolved", "escalated"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Reuse the already-authenticated user from requireSupervisor
    const { data: resolver } = await auth.supabase
      .from("employees")
      .select("id")
      .eq("user_id", auth.user?.id)
      .single();

    if (!resolver?.id) {
      return NextResponse.json({ error: "Resolver not found in employees table" }, { status: 403 });
    }

    // Migración 321: el chequeo de estado previo ("open"/"in_review") y el
    // UPDATE ocurren atómicamente dentro de resolve_ticket_atomic (CAS sobre
    // status), en vez de leer/chequear/actualizar en llamadas HTTP
    // separadas -- eso permitía que dos POST concurrentes sobre el mismo
    // ticket pisaran silenciosamente la resolución del primero.
    const { data, error } = await auth.supabase
      .rpc("resolve_ticket_atomic", {
        p_ticket_id: id,
        p_status: status,
        p_resolution_note: resolutionNote,
        p_resolver_employee_id: resolver.id,
      })
      .single();

    if (error) {
      if (error.message?.includes("TICKET_NOT_FOUND")) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
      if (error.message?.includes("TICKET_ALREADY_RESOLVED")) {
        return NextResponse.json(
          { error: "Cannot resolve: ticket is already resolved or escalated" },
          { status: 409 }
        );
      }
      console.error("admin/tickets/[id]/resolve error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    const ticket = data as { order_id: string | null };

    // E6 Sesión H — aviso de garantía/disputa al cliente. Solo cuando el
    // ticket queda 'resolved' (no en 'escalated', que sigue abierto para el
    // cliente) y tiene una orden asociada. Un fallo de comunicación nunca
    // debe revertir la resolución ya guardada del ticket.
    if (status === "resolved" && ticket.order_id) {
      try {
        const { data: order } = await auth.supabase
          .from("orders")
          .select("id, user_id, service_date")
          .eq("id", ticket.order_id)
          .single();

        if (order?.user_id) {
          const { data: profile } = await auth.supabase
            .from("profiles")
            .select("full_name")
            .eq("id", order.user_id)
            .maybeSingle();
          const { data: clientProfile } = await auth.supabase
            .from("client_profiles")
            .select("preferred_languages")
            .eq("user_id", order.user_id)
            .maybeSingle();
          const language = ((clientProfile?.preferred_languages as string[] | undefined)?.[0] ||
            "en") as "en" | "zh" | "fr";

          await dispatchCommunication(auth.supabase, {
            eventKey: "dispute_resolved",
            userId: order.user_id,
            orderId: order.id,
            language,
            vars: {
              client_name: profile?.full_name || "cliente",
              service_date: order.service_date,
              resolution_summary: resolutionNote,
            },
          });
        }
      } catch (commErr) {
        console.error("Error disparando dispute_resolved:", commErr);
      }
    }

    return NextResponse.json({ ticket: data }, { status: 200 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

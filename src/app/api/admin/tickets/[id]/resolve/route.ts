import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { dispatchCommunication } from "@/lib/send-communication";
import { safeErrorResponse } from "@/lib/api-errors";

// POST /api/admin/tickets/[id]/resolve — resolver ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminRole("tickets", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { resolutionNote, status } = body;

    if (!resolutionNote || !status) {
      return NextResponse.json({ error: "Resolution note and status required" }, { status: 400 });
    }

    if (!["resolved", "escalated"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Verificar que el ticket esté abierto o en revisión antes de resolver
    const { data: existingTicket, error: fetchError } = await auth.supabase
      .from("tickets_disputas")
      .select("status, order_id")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("admin/tickets/[id]/resolve error:", fetchError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (!existingTicket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (!["open", "in_review"].includes(existingTicket.status)) {
      return NextResponse.json(
        { error: `Cannot resolve: ticket is already ${existingTicket.status}` },
        { status: 409 }
      );
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

    const { data, error } = await auth.supabase
      .from("tickets_disputas")
      .update({
        status,
        resolution_note: resolutionNote,
        resolved_by: resolver.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("admin/tickets/[id]/resolve error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    // E6 Sesión H — aviso de garantía/disputa al cliente. Solo cuando el
    // ticket queda 'resolved' (no en 'escalated', que sigue abierto para el
    // cliente) y tiene una orden asociada. Un fallo de comunicación nunca
    // debe revertir la resolución ya guardada del ticket.
    if (status === "resolved" && existingTicket.order_id) {
      try {
        const { data: order } = await auth.supabase
          .from("orders")
          .select("id, user_id, service_date")
          .eq("id", existingTicket.order_id)
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

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/unified/timeline?business_object_type=order&business_object_id=9982
// Capa 1: Unified Communication Timeline — merge communication_attempts
// and team_chat_messages (via message_context) into a single sorted feed.
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("services", request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  }

  const url = new URL(request.url);
  const businessObjectType = url.searchParams.get("business_object_type");
  const businessObjectId = url.searchParams.get("business_object_id");

  if (!businessObjectType || !businessObjectId) {
    return NextResponse.json(
      { error: "business_object_type and business_object_id are required" },
      { status: 400 }
    );
  }

  try {
    // 1. Query communication_attempts (has admin-friendly RLS, so auth.supabase works)
    const { data: communications, error: commsError } = await auth.supabase
      .from("communication_attempts")
      .select("*")
      .eq("business_object_type", businessObjectType)
      .eq("business_object_id", businessObjectId)
      .order("emitted_at", { ascending: false });

    if (commsError) {
      console.error("unified/timeline communication_attempts error:", commsError);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    // 2. Query team_chat_messages linked via message_context.
    // Use service-role client because team_chat_messages has employee-only RLS
    // and message_context has no admin RLS policy yet.
    const serviceClient = getServiceRoleClient();
    let chatMessages: Array<{
      id: string;
      order_id: string;
      sender_employee_id: string;
      body: string;
      created_at: string;
      _channel: string;
    }> = [];

    if (serviceClient) {
      const { data: contexts, error: ctxError } = await serviceClient
        .from("message_context")
        .select("message_id, channel")
        .eq("business_object_type", businessObjectType)
        .eq("business_object_id", businessObjectId);

      if (!ctxError && contexts && contexts.length > 0) {
        const channelByMessageId = new Map<string, string>(
          contexts.map((c: { message_id: string; channel: string }) => [c.message_id, c.channel])
        );
        const messageIds = Array.from(channelByMessageId.keys());

        const { data: messages, error: msgError } = await serviceClient
          .from("team_chat_messages")
          .select("*")
          .in("id", messageIds)
          .order("created_at", { ascending: false });

        if (!msgError && messages) {
          chatMessages = messages.map(
            (msg: { id: string; order_id: string; sender_employee_id: string; body: string; created_at: string }) => ({
              ...msg,
              _channel: channelByMessageId.get(msg.id) ?? "team_chat",
            })
          );
        }
      }
    }

    // 3. Merge into unified timeline
    interface TimelineItem {
      id: string;
      type: "communication" | "chat";
      channel: string;
      direction: string;
      status: string;
      summary: string;
      timestamp: string;
      metadata: Record<string, unknown>;
    }

    const timeline: TimelineItem[] = [];

    for (const c of communications ?? []) {
      timeline.push({
        id: c.id,
        type: "communication",
        channel: c.channel,
        direction: c.direction,
        status: c.status,
        summary: c.template_id || c.emitter_system || "",
        timestamp: c.emitted_at,
        metadata: {
          emitter_system: c.emitter_system,
          recipient_id: c.recipient_id,
          recipient_type: c.recipient_type,
          error_message: c.error_message,
        },
      });
    }

    for (const msg of chatMessages) {
      timeline.push({
        id: msg.id,
        type: "chat",
        channel: msg._channel,
        direction: "internal",
        status: "sent",
        summary: msg.body,
        timestamp: msg.created_at,
        metadata: {
          order_id: msg.order_id,
          sender_employee_id: msg.sender_employee_id,
        },
      });
    }

    // Sort by timestamp descending (newest first)
    timeline.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return NextResponse.json({ timeline }, { status: 200 });
  } catch (err) {
    return safeErrorResponse(err);
  }
}

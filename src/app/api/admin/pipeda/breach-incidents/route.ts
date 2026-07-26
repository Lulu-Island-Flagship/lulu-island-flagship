import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeBreachNotificationDueAt, isBreachNotificationOverdue } from "@/lib/pipeda";
import { computeRowHash } from "@/lib/legal-monitoring";

/**
 * GET/POST /api/admin/pipeda/breach-incidents — v8.3 E9.9. Protocolo de
 * brecha: OIPC BC + afectados notificados dentro de 72h desde la
 * detección. Cada fila se encadena por hash (E9.4 "logs inmutables con
 * hash") -- ver src/lib/legal-monitoring.ts computeRowHash/verifyHashChain.
 */
export async function GET() {
  const auth = await requireAdminRole("compliance");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: incidents, error } = await auth.supabase
    .from("data_breach_incidents")
    .select(
      "id, detected_at, description, affected_client_ids, severity, oipc_notified_at, affected_notified_at, notification_due_at, status, logged_by_admin, prev_hash, row_hash, created_at"
    )
    .is("deleted_at", null)
    .order("detected_at", { ascending: false });

  if (error) {
    console.error("admin/pipeda/breach-incidents error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const now = new Date();
  const enriched = (incidents || []).map((inc) => ({
    ...inc,
    notificationOverdue: isBreachNotificationOverdue(
      new Date(inc.notification_due_at),
      now,
      inc.oipc_notified_at ? new Date(inc.oipc_notified_at) : null,
      inc.affected_notified_at ? new Date(inc.affected_notified_at) : null
    ),
  }));

  return NextResponse.json({ incidents: enriched }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("compliance", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();
    const { description, affectedClientIds, severity } = body as {
      description?: string;
      affectedClientIds?: string[];
      severity?: string;
    };

    if (!description || description.trim().length === 0) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    if (!Array.isArray(affectedClientIds)) {
      return NextResponse.json({ error: "affectedClientIds must be an array (can be empty if unknown yet)" }, { status: 400 });
    }
    const severityValue = ["low", "medium", "high", "unknown"].includes(severity || "") ? severity! : "unknown";

    const detectedAt = new Date();
    const notificationDueAt = computeBreachNotificationDueAt(detectedAt);

    // Última fila para encadenar el hash (orden real de inserción, no de
    // detected_at, para que la cadena sea íntegra sin importar cuándo se
    // haya "detectado" retroactivamente cada incidente).
    const { data: lastRow } = await supabase
      .from("data_breach_incidents")
      .select("row_hash")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevHash = lastRow?.row_hash ?? null;
    const content = JSON.stringify({
      description: description.trim(),
      affectedClientIds,
      severity: severityValue,
      detectedAt: detectedAt.toISOString(),
      loggedBy: auth.user.id,
    });
    const rowHash = computeRowHash({ prevHash, content });

    const { data: created, error } = await supabase
      .from("data_breach_incidents")
      .insert({
        detected_at: detectedAt.toISOString(),
        description: description.trim(),
        affected_client_ids: affectedClientIds,
        severity: severityValue,
        notification_due_at: notificationDueAt.toISOString(),
        status: "open",
        logged_by_admin: auth.user.id,
        prev_hash: prevHash,
        row_hash: rowHash,
      })
      .select()
      .single();

    if (error) {
      console.error("admin/pipeda/breach-incidents error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ incident: created }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

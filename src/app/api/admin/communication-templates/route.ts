import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";

/**
 * v8.3 E6 — Panel de edición de plantillas de comunicación (M13).
 * El catálogo de eventos vive en communication_events (migración 045).
 * Editar el texto de una plantilla NO crea un sistema de historial nuevo:
 * reutiliza el snapshot/undo genérico de E0 (config_snapshots +
 * admin_update_config, ver migración 057 y /api/admin/config-history
 * como referencia exacta del mismo patrón).
 *
 * GET:  catálogo de eventos + plantilla vigente (is_current=true) por
 *       idioma, si existe.
 * POST: crea la primera plantilla de un evento+idioma (INSERT, sin
 *       historial que deshacer todavía), o edita la vigente (UPDATE vía
 *       RPC auditado con motivo obligatorio + snapshot).
 *
 * Se reutiliza el recurso RBAC "finance" (owner_admin) — el mismo que usa
 * /api/admin/config-history — porque no existe un recurso RBAC dedicado
 * a "communications" y esta tarea tiene prohibido tocar admin-rbac.ts.
 * Ver informe final para la recomendación de agregar un recurso dedicado.
 */

interface TemplateRow {
  id: string;
  event_key: string;
  language: string;
  version: number;
  subject: string | null;
  body: string;
  is_current: boolean;
  created_at: string;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data: events, error: eventsError } = await auth.supabase
    .from("communication_events")
    .select("event_key, description, category, priority, default_channel, fallback_channels, is_active")
    .is("deleted_at", null)
    .order("event_key", { ascending: true });

  if (eventsError) {
    console.error("admin/communication-templates error:", eventsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: templates, error: templatesError } = await auth.supabase
    .from("communication_templates")
    .select("id, event_key, language, version, subject, body, is_current, created_at")
    .eq("is_current", true)
    .is("deleted_at", null);

  if (templatesError) {
    console.error("admin/communication-templates error:", templatesError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const templatesByEvent = new Map<string, TemplateRow[]>();
  for (const t of (templates ?? []) as TemplateRow[]) {
    const list = templatesByEvent.get(t.event_key) ?? [];
    list.push(t);
    templatesByEvent.set(t.event_key, list);
  }

  const result = (events ?? []).map((e) => ({
    ...e,
    templates: templatesByEvent.get(e.event_key) ?? [],
  }));

  return NextResponse.json({ events: result });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("finance", {
    method: request.method,
    url: request.url,
  });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "finance", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  let payload: {
    eventKey?: string;
    language?: string;
    subject?: string;
    body?: string;
    reason?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { eventKey, language, body } = payload;
  if (!eventKey || !language || !body || !body.trim()) {
    return NextResponse.json(
      { error: "Se requiere { eventKey, language, body }" },
      { status: 400 }
    );
  }
  if (!["en", "zh", "fr"].includes(language)) {
    return NextResponse.json({ error: "language debe ser en, zh o fr" }, { status: 400 });
  }

  const { data: existing, error: findError } = await auth.supabase
    .from("communication_templates")
    .select("id")
    .eq("event_key", eventKey)
    .eq("language", language)
    .eq("is_current", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (findError) {
    console.error("admin/communication-templates error:", findError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  if (!existing) {
    // Primera plantilla para este evento+idioma: INSERT directo.
    // No hay nada que "deshacer" todavía — el historial empieza en la
    // primera edición posterior (UPDATE, más abajo).
    const { data, error } = await auth.supabase
      .from("communication_templates")
      .insert({
        event_key: eventKey,
        language,
        version: 1,
        subject: payload.subject ?? null,
        body,
        is_current: true,
        created_by: auth.user.id,
      })
      .select("id, event_key, language, version, subject, body, is_current, created_at")
      .single();

    if (error) {
      console.error("admin/communication-templates error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ template: data, created: true });
  }

  // Edición de la plantilla vigente: vía RPC auditado (E0-C6) — motivo
  // obligatorio, snapshot inmutable, deshacer disponible en
  // /api/admin/config-history?table=communication_templates.
  const reason =
    payload.reason?.trim() ||
    `Panel de comunicaciones: edición de plantilla '${eventKey}' (${language})`;

  const { data, error } = await auth.supabase.rpc("admin_update_config", {
    p_table: "communication_templates",
    p_id: existing.id,
    p_changes: { subject: payload.subject ?? null, body },
    p_reason: reason,
  });

  if (error) {
    console.error("admin/communication-templates error:", error);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ template: data, created: false });
}

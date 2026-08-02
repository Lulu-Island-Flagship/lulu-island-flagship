import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { immediateActivationReason, type ImmediateTrigger } from "@/lib/succession";
import { safeErrorResponse } from "@/lib/api-errors";

/**
 * GET /api/admin/succession — estado de Modo Sucesión + personas de
 * confianza. Solo owner_admin (datos personales de las personas de
 * confianza, no es operativo del día a día -- misma sensibilidad que
 * employees_admin).
 *
 * POST /api/admin/succession:
 *   { action: "add_successor", name, relationship?, contactPhone?, contactEmail?, notes? }
 *   { action: "deactivate_successor", id }
 *   { action: "activate_immediately", trigger: "incapacity_declared"|"death_certified" }
 *     -- activación humana, irreversible por el cron (succession-check.ts
 *     nunca pisa 'manually_activated').
 */
export async function GET() {
  const auth = await requireAdminRole("employees_admin");
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { data: status, error: statusError } = await auth.supabase
    .from("succession_status")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (statusError) {
    console.error("admin/succession error:", statusError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: successors, error: successorsError } = await auth.supabase
    .from("trusted_successors")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (successorsError) {
    console.error("admin/succession error:", successorsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ status: status || null, successors: successors || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("employees_admin", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }
  const { supabase } = auth;

  try {
    const body = await request.json();

    if (body.action === "add_successor") {
      if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      const { data: successor, error } = await supabase
        .from("trusted_successors")
        .insert({
          name: body.name.trim(),
          relationship: body.relationship ? String(body.relationship).trim() : null,
          contact_phone: body.contactPhone ? String(body.contactPhone).trim() : null,
          contact_email: body.contactEmail ? String(body.contactEmail).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
          granted_access_at: body.grantedAccessAt || null,
        })
        .select()
        .single();

      if (error) {
        console.error("admin/succession error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      return NextResponse.json({ successor }, { status: 201 });
    }

    if (body.action === "deactivate_successor") {
      if (!body.id) {
        return NextResponse.json({ error: "id is required" }, { status: 400 });
      }
      const { data: successor, error } = await supabase
        .from("trusted_successors")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", body.id)
        .select()
        .single();

      if (error) {
        console.error("admin/succession error:", error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
      return NextResponse.json({ successor }, { status: 200 });
    }

    if (body.action === "activate_immediately") {
      const trigger = body.trigger as ImmediateTrigger;
      if (trigger !== "incapacity_declared" && trigger !== "death_certified") {
        return NextResponse.json(
          { error: "trigger must be 'incapacity_declared' or 'death_certified'" },
          { status: 400 }
        );
      }
      if (body.confirm !== true) {
        return NextResponse.json(
          { error: "This is an irreversible manual activation. Resend with confirm: true." },
          { status: 400 }
        );
      }

      const reason = immediateActivationReason(trigger);
      const nowIso = new Date().toISOString();

      // succession_status.activated_by referencia employees(id), no
      // auth.users(id) -- el owner_admin no necesariamente tiene fila en
      // employees (no es personal de campo). Si no existe, se deja null en
      // vez de romper la activación por un detalle de auditoría secundario.
      const { data: employeeRow } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", auth.user.id)
        .maybeSingle();

      const { data: currentStatusRow } = await supabase
        .from("succession_status")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const update = {
        status: "manually_activated",
        activated_at: nowIso,
        activated_reason: reason,
        activated_by: employeeRow?.id ?? null,
        last_evaluated_at: nowIso,
      };

      let result;
      if (currentStatusRow) {
        result = await supabase.from("succession_status").update(update).eq("id", currentStatusRow.id).select().single();
      } else {
        result = await supabase.from("succession_status").insert(update).select().single();
      }
      if (result.error) {
        console.error("succession_status upsert error:", result.error);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }

      return NextResponse.json({ status: result.data }, { status: 200 });
    }

    return NextResponse.json({ error: "Unrecognized action" }, { status: 400 });
  } catch (err: Error | unknown) {
        return safeErrorResponse(err);
  }
}

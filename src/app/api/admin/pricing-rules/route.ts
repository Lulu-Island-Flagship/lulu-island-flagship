import { NextRequest, NextResponse } from "next/server";
import { requireSupervisor } from "@/lib/admin";
import type { PricingRule } from "@/lib/rules";

const ALLOWED_ACTION_TYPES = [
  "price_multiplier",
  "price_add",
  "price_set",
  "block",
  "flag_for_review",
] as const;

function isValidCondition(condition: unknown): boolean {
  if (!condition || typeof condition !== "object") return false;

  if ("field" in (condition as Record<string, unknown>)) {
    const c = condition as { field?: unknown; op?: unknown; value?: unknown };
    const validOps = ["==", "!=", ">", ">=", "<", "<=", "in", "not_in", "contains"];
    return (
      typeof c.field === "string" &&
      typeof c.op === "string" &&
      validOps.includes(c.op)
    );
  }

  const group = condition as { and?: unknown[]; or?: unknown[] };
  if (Array.isArray(group.and) && group.and.length > 0) {
    return group.and.every(isValidCondition);
  }
  if (Array.isArray(group.or) && group.or.length > 0) {
    return group.or.every(isValidCondition);
  }

  return false;
}

function validateRuleBody(body: Record<string, unknown>): { valid: false; error: string } | { valid: true } {
  const { name, conditionJson, actionType, actionValue, priority, maxApplicable, reason } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return { valid: false, error: "Rule name is required" };
  }

  if (!conditionJson || typeof conditionJson !== "object" || !isValidCondition(conditionJson)) {
    return { valid: false, error: "Invalid conditionJson structure" };
  }

  if (!actionType || !ALLOWED_ACTION_TYPES.includes(actionType as PricingRule["actionType"])) {
    return { valid: false, error: `Invalid actionType. Must be one of: ${ALLOWED_ACTION_TYPES.join(", ")}` };
  }

  const needsValue = actionType !== "block" && actionType !== "flag_for_review";
  if (needsValue && (actionValue === undefined || actionValue === null || typeof actionValue !== "number")) {
    return { valid: false, error: `actionValue is required for actionType ${actionType}` };
  }

  if (actionType === "price_multiplier" && (actionValue as number) <= 0) {
    return { valid: false, error: "price_multiplier must be greater than 0" };
  }

  if (priority !== undefined && (typeof priority !== "number" || priority < 0)) {
    return { valid: false, error: "priority must be a non-negative number" };
  }

  if (maxApplicable !== undefined && typeof maxApplicable !== "boolean") {
    return { valid: false, error: "maxApplicable must be a boolean" };
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return { valid: false, error: "reason is required for audit log" };
  }

  return { valid: true };
}

// GET /api/admin/pricing-rules — listar reglas activas e históricas
export async function GET() {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { data: rules, error } = await auth.supabase
      .from("pricing_rules")
      .select("*")
      .is("deleted_at", null)
      .order("priority", { ascending: false });

    if (error) {
      console.error("Pricing rules fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ rules: rules || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/admin/pricing-rules — crear nueva regla
export async function POST(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const validation = validateRuleBody(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { name, description, conditionJson, actionType, actionValue, priority, maxApplicable, reason } = body;

    const { data: rule, error } = await auth.supabase
      .from("pricing_rules")
      .insert({
        name,
        description,
        condition_json: conditionJson,
        action_type: actionType,
        action_value: actionValue,
        priority: priority ?? 0,
        max_applicable: maxApplicable ?? true,
        is_active: true,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (error) {
      console.error("Pricing rule insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auditoría de reglas
    await auth.supabase.from("rule_audit_logs").insert({
      rule_id: rule.id,
      new_rule: rule,
      changed_by: auth.user.id,
      reason: reason || "Rule created",
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH /api/admin/pricing-rules — actualizar regla existente
export async function PATCH(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const { id, reason, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "Rule id is required" }, { status: 400 });
    }
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return NextResponse.json({ error: "Reason is required for audit log" }, { status: 400 });
    }

    // Validar que los campos actualizados sean válidos si se envían
    const validation = validateRuleBody({ ...updates, reason });
    if (!validation.valid && (updates.actionType || updates.conditionJson || updates.actionValue !== undefined)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data: previous } = await auth.supabase
      .from("pricing_rules")
      .select("*")
      .is("deleted_at", null)
      .eq("id", id)
      .single();

    const { data: rule, error } = await auth.supabase
      .from("pricing_rules")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Pricing rule update error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await auth.supabase.from("rule_audit_logs").insert({
      rule_id: id,
      previous_rule: previous || {},
      new_rule: rule,
      changed_by: auth.user.id,
      reason,
    });

    return NextResponse.json({ rule }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/admin/pricing-rules — eliminar regla con auditoría
export async function DELETE(request: NextRequest) {
  const auth = await requireSupervisor();
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const reason = searchParams.get("reason");

    if (!id) {
      return NextResponse.json({ error: "Rule id is required" }, { status: 400 });
    }
    if (!reason || reason.trim().length === 0) {
      return NextResponse.json({ error: "Reason is required for audit log" }, { status: 400 });
    }

    const { data: previous } = await auth.supabase
      .from("pricing_rules")
      .select("*")
      .is("deleted_at", null)
      .eq("id", id)
      .single();

    const { error } = await auth.supabase.from("pricing_rules").delete().eq("id", id);

    if (error) {
      console.error("Pricing rule delete error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await auth.supabase.from("rule_audit_logs").insert({
      rule_id: id,
      previous_rule: previous || {},
      new_rule: null,
      changed_by: auth.user.id,
      reason: `Rule deleted: ${reason}`,
    });

    return NextResponse.json({ success: true, deletedId: id }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("pricing_rules", { method: request.method, url: request.url });
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const ruleId = searchParams.get("ruleId");

  try {
    let query = auth.supabase
      .from("rule_audit_logs")
      .select("id, rule_id, reason, created_at, changed_by")
      .order("created_at", { ascending: false })
      .limit(50);

    if (ruleId) {
      query = query.eq("rule_id", ruleId);
    }

    const { data: logs, error } = await query;

    if (error) {
      console.error("Rule audit logs fetch error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    return NextResponse.json({ logs: logs || [] }, { status: 200 });
  } catch (err: Error | unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

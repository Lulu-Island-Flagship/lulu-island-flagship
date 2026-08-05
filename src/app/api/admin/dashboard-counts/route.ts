import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("dashboard", request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const counts: Record<string, number> = {};

  const { count: applicantsCount } = await auth.supabase
    .from("candidates")
    .select("*", { count: "exact", head: true })
    .eq("status", "step1_completed");
  counts.newApplicants = applicantsCount ?? 0;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { count: clientsCount } = await auth.supabase
    .from("client_profiles")
    .select("*", { count: "exact", head: true })
    .gte("created_at", sevenDaysAgo.toISOString());
  counts.newClients = clientsCount ?? 0;

  const { count: dispatchCount } = await auth.supabase
    .from("orders")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");
  counts.pendingDispatch = dispatchCount ?? 0;

  const { count: alertsCount } = await auth.supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .is("resolved_at", null);
  counts.activeAlerts = alertsCount ?? 0;

  return NextResponse.json({ counts }, { status: 200 });
}

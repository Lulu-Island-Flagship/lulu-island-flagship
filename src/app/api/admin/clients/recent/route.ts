import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("clients", request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: profiles, error } = await auth.supabase
    .from("client_profiles")
    .select("id, user_id, first_name, last_name, phone_number, created_at")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }

  const userIds = (profiles || []).map((p) => p.user_id).filter(Boolean);
  let emailMap: Record<string, string> = {};

  if (userIds.length > 0) {
    try {
      const { data: users, error: usersError } = await auth.supabase.auth.admin.listUsers({
        page: 1,
        perPage: userIds.length,
      });
      if (!usersError && users?.users) {
        for (const user of users.users) {
          if (user.email) emailMap[user.id] = user.email;
        }
      }
    } catch { /* best-effort */ }
  }

  const clients = (profiles || []).map((p) => ({
    id: p.id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "—",
    email: emailMap[p.user_id] || "—",
    phone: p.phone_number || "—",
    createdAt: p.created_at,
  }));

  return NextResponse.json({ clients }, { status: 200 });
}

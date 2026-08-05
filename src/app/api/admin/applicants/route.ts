import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";

// GET /api/admin/applicants?status=step1_completed&limit=50&offset=0
// Lista candidatos del flujo de contratación con filtro por status.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("applicants", request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
  const offset = Number(searchParams.get("offset")) || 0;

  let query = auth.supabase
    .from("candidates")
    .select(
      "id, first_name, last_name, email, phone, date_of_birth, status, created_at, position_id, positions(title)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[admin/applicants] Failed to fetch candidates:", error.message);
    return NextResponse.json({ error: "Failed to load applicants" }, { status: 500 });
  }

  const candidateIds = (data || []).map((c) => c.id);
  const docCounts: Record<string, number> = {};

  if (candidateIds.length > 0) {
    const { data: docs } = await auth.supabase
      .from("documents")
      .select("candidate_id")
      .in("candidate_id", candidateIds)
      .eq("document_type", "resume");

    if (docs) {
      for (const doc of docs) {
        docCounts[doc.candidate_id] = (docCounts[doc.candidate_id] || 0) + 1;
      }
    }
  }

  const applicants = (data || []).map((c) => ({
    id: c.id,
    firstName: c.first_name,
    lastName: c.last_name,
    email: c.email,
    phone: c.phone,
    dateOfBirth: c.date_of_birth,
    status: c.status,
    createdAt: c.created_at,
    position: (c.positions as { title?: string } | null)?.title || "General",
    hasResume: (docCounts[c.id] || 0) > 0,
  }));

  return NextResponse.json({ applicants, total: count ?? 0 }, { status: 200 });
}

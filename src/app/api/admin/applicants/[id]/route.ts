import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, logAdminAction } from "@/lib/admin";

// PATCH /api/admin/applicants/[id]
// Aprueba o rechaza un candidato. Body: { action: "approve" | "reject" }

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminRole("applicants", request);
  if (auth.error || !auth.supabase || !auth.user) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const logResult = await logAdminAction({
    supabase: auth.supabase, user: auth.user, roles: auth.roles,
    resource: "applicants", method: request.method, path: request.url,
  });
  if (logResult.error) return NextResponse.json({ error: logResult.error }, { status: logResult.status });

  const candidateId = params.id;
  if (!candidateId) {
    return NextResponse.json({ error: "Missing applicant ID" }, { status: 400 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
  }

  const newStatus = body.action === "approve" ? "approved" : "rejected";

  const { data: candidate, error: fetchError } = await auth.supabase
    .from("candidates")
    .select("id, status")
    .eq("id", candidateId)
    .single();

  if (fetchError || !candidate) {
    return NextResponse.json({ error: "Applicant not found" }, { status: 404 });
  }

  if (candidate.status === "approved" || candidate.status === "rejected") {
    return NextResponse.json({ error: `Applicant is already ${candidate.status}` }, { status: 409 });
  }

  const { data, error } = await auth.supabase
    .from("candidates")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", candidateId)
    .select("id, status, updated_at")
    .single();

  if (error) {
    console.error(`[admin/applicants] Failed to ${body.action} candidate ${candidateId}:`, error.message);
    return NextResponse.json({ error: "Failed to update applicant status" }, { status: 500 });
  }

  return NextResponse.json({ applicant: data }, { status: 200 });
}

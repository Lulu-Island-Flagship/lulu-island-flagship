import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole, getServiceRoleClient } from "@/lib/admin";

export async function GET(
  _request: NextRequest,
  { params }: { params: { applicantId: string } }
) {
  const auth = await requireAdminRole("applicants", _request);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const candidateId = params.applicantId;
  if (!candidateId) {
    return NextResponse.json({ error: "Missing applicant ID" }, { status: 400 });
  }

  const { data: docs, error: docsError } = await auth.supabase
    .from("documents")
    .select("storage_path")
    .eq("candidate_id", candidateId)
    .eq("document_type", "resume")
    .order("uploaded_at", { ascending: false })
    .limit(1);

  if (docsError) {
    return NextResponse.json({ error: "Failed to retrieve resume" }, { status: 500 });
  }

  if (!docs || docs.length === 0) {
    return NextResponse.json({ error: "No resume found" }, { status: 404 });
  }

  // Usar service role client para storage (bypassea RLS). El admin ya fue
  // validado por requireAdminRole arriba — no hay escalada de privilegios.
  const serviceClient = getServiceRoleClient();
  if (!serviceClient) {
    return NextResponse.json({ error: "Storage service unavailable" }, { status: 500 });
  }

  const { data: signedData, error: signedError } = await serviceClient.storage
    .from("candidate-documents")
    .createSignedUrl(docs[0].storage_path, 3600);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json({ error: "Failed to generate resume URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signedData.signedUrl }, { status: 200 });
}

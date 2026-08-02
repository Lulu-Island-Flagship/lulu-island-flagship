import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { computeWithdrawalDeadline } from "@/lib/live-portfolio";
import { isValidUuid } from "@/lib/validation";

/**
 * POST /api/admin/live-portfolio/[id] — { action: 'approve'|'reject', selectedPhotoUrl?, reason? }
 *
 * v8.3 E5.15: "aprobación admin de un toque". El admin ya vio el
 * before/after y decide aquí si la diferencia visual justifica publicarlo
 * (juicio humano, ver nota honesta en src/lib/live-portfolio.ts). Aprobar
 * arranca el reloj del derecho de retiro (<24h) del cliente.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdminRole("live_portfolio_publish", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;
  if (!supabase || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isValidUuid(params.id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  let body: { action?: string; selectedPhotoUrl?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { data: candidate, error: fetchError } = await supabase
    .from("live_portfolio_candidates")
    .select("id, status, candidate_photo_urls")
    .eq("id", params.id)
    .maybeSingle();
  if (fetchError) {
    console.error("admin/live-portfolio/[id] error:", fetchError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }
  if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (candidate.status !== "candidate") {
    return NextResponse.json({ error: `Already resolved as '${candidate.status}'` }, { status: 409 });
  }

  const nowIso = new Date().toISOString();

  if (body.action === "approve") {
    const selectedPhotoUrl =
      body.selectedPhotoUrl && candidate.candidate_photo_urls.includes(body.selectedPhotoUrl)
        ? body.selectedPhotoUrl
        : candidate.candidate_photo_urls[0];

    const { data, error } = await supabase
      .from("live_portfolio_candidates")
      .update({
        status: "approved",
        selected_photo_url: selectedPhotoUrl,
        approved_at: nowIso,
        approved_by: user.id,
        withdrawal_deadline: computeWithdrawalDeadline(nowIso),
        updated_at: nowIso,
      })
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      console.error("admin/live-portfolio/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ candidate: data }, { status: 200 });
  }

  if (body.action === "reject") {
    const { data, error } = await supabase
      .from("live_portfolio_candidates")
      .update({
        status: "rejected",
        rejected_at: nowIso,
        rejected_reason: body.reason || null,
        updated_at: nowIso,
      })
      .eq("id", params.id)
      .select()
      .single();

    if (error) {
      console.error("admin/live-portfolio/[id] error:", error);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ candidate: data }, { status: 200 });
  }

  return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
}

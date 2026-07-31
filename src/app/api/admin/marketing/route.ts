import { NextRequest, NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/admin";
import { evaluatePostForApproval, approvePost, publishPost, rejectPost } from "@/lib/blog-content";
import { validatePositioningCoherence } from "@/lib/positioning-coherence";
import { isFlagEnabled, type FlagClient } from "@/lib/feature-flags";
import { safeErrorResponse } from "@/lib/api-errors";

// GET /api/admin/marketing — cola de posts del blog por estado + últimas
// validaciones PIPA (marketing_pipa_checks, log inmutable compartido por
// cualquier tipo de pieza de marketing, no solo blog).
//
// POST /api/admin/marketing — flujo de aprobación de un toque (spec E10.7):
//   { action: "evaluate", id } — corre evaluatePostForApproval() (PIPA,
//     B.2.20) Y validatePositioningCoherence() (B.2.24/B.2.25, el flag de
//     pólizas se resuelve aquí via isFlagEnabled — fail-closed real, nunca
//     asumido). Registra el resultado en marketing_pipa_checks (log
//     inmutable) y, si ambos pasan, mueve draft -> pending_approval.
//   { action: "approve", id } — approvePost(), exige pending_approval.
//   { action: "reject", id } — rejectPost().
//   { action: "publish", id } — publishPost(), exige approved.
//
// Resource "upsells_review": mismo bucket RBAC que otros flujos de
// aprobación de un toque por ops_coordinator/owner_admin (upsells, tickets).
// No existe un recurso "marketing" dedicado en admin-rbac.ts y ese archivo
// está fuera de alcance de esta tanda.

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole("upsells_review", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase } = auth;
  if (!supabase) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: posts, error: postsError } = await supabase
    .from("blog_posts")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (postsError) {
    console.error("admin/marketing error:", postsError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  const { data: checks, error: checksError } = await supabase
    .from("marketing_pipa_checks")
    .select("*")
    .order("checked_at", { ascending: false })
    .limit(20);
  if (checksError) {
    console.error("admin/marketing error:", checksError);
    return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
  }

  return NextResponse.json({ posts: posts || [], recentChecks: checks || [] }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole("upsells_review", { method: request.method, url: request.url });
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { supabase, user } = auth;
  if (!supabase || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fix (auditoría 2026-07-30, item 11): request.json() sin try/catch podía
  // tronar con una excepción no controlada (500 con fuga de stack trace) si
  // el body no era JSON válido, y body.id se usaba sin validar que existiera
  // (undefined pasado directo a .eq("id", ...)). Se valida explícitamente y
  // se responde 400 genérico ante body inválido, en vez de dejar que el
  // error suba sin control.
  let body: { action?: string; id?: string };
  try {
    body = await request.json();
  } catch (err) {
    return safeErrorResponse(err, 400, "JSON inválido");
  }
  if (!body || typeof body.id !== "string" || !body.id.trim()) {
    return NextResponse.json({ error: "id es obligatorio" }, { status: 400 });
  }

  const { data: post, error: postError } = await supabase
    .from("blog_posts")
    .select("*")
    .eq("id", body.id)
    .is("deleted_at", null)
    .single();
  if (postError || !post) {
    return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });
  }

  if (body.action === "evaluate") {
    const evaluation = evaluatePostForApproval({
      content: post.content,
      sourceMetadata: { triggerType: post.source_trigger_type, sampleSize: post.source_sample_size },
    });

    // Cast estructural: el cliente real de supabase-js satisface FlagClient en
    // runtime (mismo método .from().select().eq().is().maybeSingle()), pero su
    // tipo genérico es demasiado profundo para que TS lo infiera contra la
    // interfaz mínima de FlagClient (TS2589). El contrato real se verifica en
    // isFlagEnabled(), que es fail-closed ante cualquier forma inesperada.
    const bondedPolicyFlagActive = await isFlagEnabled(supabase as unknown as FlagClient, "pólizas_seguro");
    const positioning = validatePositioningCoherence(post.content, { bondedPolicyFlagActive });

    const passed = evaluation.readyForApproval && positioning.passes;
    const violations = [...evaluation.pipaViolations, ...positioning.violations];

    const { error: checkInsertError } = await supabase.from("marketing_pipa_checks").insert({
      content_type: "blog_post",
      content_ref: post.id,
      passed,
      violations,
    });
    if (checkInsertError) {
      console.error("admin/marketing error:", checkInsertError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }

    if (passed) {
      const { error: updateError } = await supabase
        .from("blog_posts")
        .update({ status: "pending_approval" })
        .eq("id", post.id);
      if (updateError) {
        console.error("admin/marketing error:", updateError);
        return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
      }
    }

    return NextResponse.json({ passed, evaluation, positioning }, { status: 200 });
  }

  if (body.action === "approve") {
    const result = approvePost({ status: post.status }, user.id);
    if (!result.success) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    const { error: updateError } = await supabase
      .from("blog_posts")
      .update({ status: result.newStatus, approved_at: new Date().toISOString(), approved_by: user.id })
      .eq("id", post.id);
    if (updateError) {
      console.error("admin/marketing error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ result }, { status: 200 });
  }

  if (body.action === "reject") {
    const result = rejectPost({ status: post.status });
    if (!result.success) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    const { error: updateError } = await supabase
      .from("blog_posts")
      .update({ status: result.newStatus })
      .eq("id", post.id);
    if (updateError) {
      console.error("admin/marketing error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ result }, { status: 200 });
  }

  if (body.action === "publish") {
    const result = publishPost({ status: post.status });
    if (!result.success) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    const { error: updateError } = await supabase
      .from("blog_posts")
      .update({ status: result.newStatus, published_at: new Date().toISOString() })
      .eq("id", post.id);
    if (updateError) {
      console.error("admin/marketing error:", updateError);
      return NextResponse.json({ error: "Ocurrió un error interno" }, { status: 500 });
    }
    return NextResponse.json({ result }, { status: 200 });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}
